import {
	InstanceBase,
	runEntrypoint,
	InstanceStatus,
	type SomeCompanionConfigField,
	type CompanionActionInfo,
} from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { WebSocketServer, WebSocket } from 'ws'
import { SocketCommandActionType, SocketCommandType, type SocketCommand } from './command.js'
import { ModuleState } from './state.js'

export class ModuleInstance extends InstanceBase<ModuleConfig> {
	config!: ModuleConfig
	private wss: WebSocketServer | undefined
	private clients: Set<WebSocket> = new Set()
	public state: ModuleState = new ModuleState()
	private activeActions: Map<string, CompanionActionInfo> = new Map()
	public controlIdToActionId: Map<string, string> = new Map()
	private lastReportedLocation: Map<string, string> = new Map()

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.log('info', 'Initializing Nextotalk Module')
		this.config = config
		this.updateStatus(InstanceStatus.Ok)
		this.initWebSocketServer()
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
	}

	async destroy(): Promise<void> {
		if (this.wss) this.wss.close()
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		const oldPort = this.config.port
		this.config = config
		if (oldPort !== this.config.port) {
			if (this.wss) this.wss.close()
			this.initWebSocketServer()
		}
	}

	private initWebSocketServer(): void {
		const port = this.config.port || 7005
		this.wss = new WebSocketServer({ port })
		this.wss.on('connection', (ws) => {
			this.clients.add(ws)
			this.log('info', 'Client Connected to WebSocket Server')

			const welcomePayload: SocketCommand = {
				type: SocketCommandType.Event,
				action: SocketCommandActionType.Welcome,
				data: { version: '1.0.0.0-companion' },
			}
			ws.send(JSON.stringify(welcomePayload))

			ws.on('message', (message) => {
				try {
					const command: SocketCommand = JSON.parse((message as Buffer).toString())
					this.handleMessage(ws, command)
				} catch (e) {
					this.log('error', `WS Parse Error: ${e}`)
				}
			})
			ws.on('close', () => {
				this.clients.delete(ws)
				this.log('info', 'Client Disconnected')
			})
		})
	}

	private handleMessage(ws: WebSocket, command: SocketCommand): void {
		this.log('debug', `Received message: ${command.action}`)
		switch (command.action) {
			case SocketCommandActionType.Join:
				this.streamAvailableActions(ws)
				break
			case SocketCommandActionType.Reset:
				this.log('info', 'Resetting all module state')
				this.state.reset()
				this.lastReportedLocation.clear()
				this.checkFeedbacks('mic_status')

				// Send acknowledgment response
				if (command.type === SocketCommandType.Request) {
					ws.send(
						JSON.stringify({
							type: SocketCommandType.Response,
							action: SocketCommandActionType.Reset,
							data: { success: true },
						}),
					)
				}
				break
			case SocketCommandActionType.MapSDKeyToRoom: {
				const { sdKeyId, meetingId, coordinates } = command.data
				if (meetingId !== undefined) this.state.mapActionToMeeting(sdKeyId, meetingId)
				if (coordinates) {
					this.state.setControlLocation(sdKeyId, coordinates.row, coordinates.column)
					this.checkActionPositionUpdate(sdKeyId)
				}
				break
			}
			case SocketCommandActionType.GetStreamDeckDevices:
				ws.send(
					JSON.stringify({
						type: SocketCommandType.Response,
						action: SocketCommandActionType.GetStreamDeckDevices,
						data: [{ id: 'companion-surface', name: 'Companion Panel', size: { columns: 8, rows: 4 } }],
					}),
				)
				break
			case SocketCommandActionType.GetMicControllerKeys:
				this.streamAvailableActions(ws)
				break
			case SocketCommandActionType.PersistedRoomMeta: {
				// Build the persisted room metadata response
				const roomMetaMap: Record<string, { roomNumber: number; sdKeyId: string; roomName?: string }> = {}

				// Iterate through all meetings and build the metadata
				for (const [meetingId, roomNumber] of Object.entries(this.state.meetingRoomNumberMap)) {
					const actionId = this.state.meetingIdActionIdMap[meetingId]
					const roomName = this.state.meetingIdTitleMap[meetingId]

					if (actionId) {
						roomMetaMap[meetingId] = {
							roomNumber,
							sdKeyId: actionId,
							roomName,
						}
					}
				}

				ws.send(
					JSON.stringify({
						type: SocketCommandType.Response,
						action: SocketCommandActionType.PersistedRoomMeta,
						data: roomMetaMap,
					}),
				)

				this.log('info', `Sent persisted room metadata for ${Object.keys(roomMetaMap).length} meetings`)
				break
			}
			case SocketCommandActionType.AllocateRoom: {
				const meetingId = command.data.meetingId
				const serialNumber = this.state.getSerialNumberForMeeting(meetingId)

				if (serialNumber !== null) {
					// Store room name if provided in the allocation request
					if (command.data.roomName) {
						this.state.updateRoomName(meetingId, command.data.roomName)
					}

					command.data.serialNumber = serialNumber

					// Find a suggested key if possible
					let suggestedSDKey: any = null
					const cachedActionId = this.state.meetingIdActionIdMap[meetingId]

					if (cachedActionId) {
						this.log('debug', `Found cached action ${cachedActionId} for meeting ${meetingId}`)
						const action = this.activeActions.get(cachedActionId)
						if (action) {
							suggestedSDKey = {
								id: action.id,
								coordinates: this.getCoordinatesFromAction(action),
								visible: true,
							}
							this.log('debug', `Using cached action as suggested key`)
						} else {
							this.log('warn', `Cached action ${cachedActionId} not found in activeActions`)
						}
					} else {
						this.log('debug', `No cached action for meeting ${meetingId}, searching for free button...`)
						// No previous mapping, find a free visible button
						suggestedSDKey = this.findNonAllocatedVisibleAction()
						if (suggestedSDKey) {
							this.log('info', `Found free button ${suggestedSDKey.id} for meeting ${meetingId}`)
							this.state.mapActionToMeeting(suggestedSDKey.id, meetingId)
						} else {
							this.log('warn', `No free buttons available for meeting ${meetingId}`)
						}
					}

					if (suggestedSDKey) {
						command.data.suggestedSDKey = suggestedSDKey
						this.log('debug', `Including suggestedSDKey in response: ${JSON.stringify(suggestedSDKey)}`)
					} else {
						this.log('warn', `No suggestedSDKey available for meeting ${meetingId}`)
					}

					ws.send(
						JSON.stringify({
							type: SocketCommandType.Response,
							action: SocketCommandActionType.RoomAllocated,
							data: command.data,
						}),
					)

					this.log('info', `Allocated Room ${serialNumber} for Meeting ${meetingId}`)
					this.checkFeedbacks('mic_status') // Refresh feedback for UI
				}
				break
			}
			case SocketCommandActionType.UpdateMicStatus: {
				const { meetingId, isMuted } = command.data
				this.state.updateMicStatus(meetingId, isMuted)
				this.checkFeedbacks('mic_status')
				break
			}
			case SocketCommandActionType.UpdateRoomName: {
				const { meetingId, roomName } = command.data
				this.state.updateRoomName(meetingId, roomName)
				this.log('info', `Updated room name for ${meetingId}: ${roomName}`)
				this.checkFeedbacks('mic_status')

				// Send acknowledgment response if it was a request
				if (command.type === SocketCommandType.Request) {
					ws.send(
						JSON.stringify({
							type: SocketCommandType.Response,
							action: SocketCommandActionType.UpdateRoomName,
							data: { meetingId, roomName, success: true },
						}),
					)
				}
				break
			}
		}
	}

	public onActionAppearance(action: CompanionActionInfo, isAppearing: boolean): void {
		if (isAppearing) {
			this.log('info', `Action Appearing - ID: ${action.id}, Control: ${action.controlId}`)
			this.activeActions.set(action.id, action)
			this.controlIdToActionId.set(action.controlId, action.id)
			if (action.actionId === 'toggle_mic') this.sendActionAppear(action)
		} else {
			this.log('info', `Action Disappearing - ID: ${action.id}`)
			this.activeActions.delete(action.id)
			this.controlIdToActionId.delete(action.controlId)
			this.lastReportedLocation.delete(action.id)
			if (action.actionId === 'toggle_mic') this.sendActionDisappear(action)
		}
	}

	public checkActionPositionUpdate(controlId: string): void {
		const actionId = this.controlIdToActionId.get(controlId)
		if (actionId) {
			const action = this.activeActions.get(actionId)
			if (action && action.actionId === 'toggle_mic') {
				this.sendActionAppear(action, true) // Force update
			}
		}
	}

	private sendActionAppear(action: CompanionActionInfo, force = false): void {
		const coords = this.getCoordinatesFromAction(action)

		// CRITICAL: Previously we were defaulting to 0,0.
		// Now we wait for the feedback to discover the REAL coordinates.
		if (!coords) {
			this.log('debug', `Delaying appearance for ${action.controlId} until coordinates are discovered...`)
			return
		}

		const locKey = `${coords.row},${coords.column}`

		if (!force && this.lastReportedLocation.get(action.id) === locKey) {
			return
		}

		this.lastReportedLocation.set(action.id, locKey)
		this.log('info', `Reporting Action at: ${coords.row},${coords.column} for ${action.controlId}`)

		this.broadcast({
			type: SocketCommandType.Event,
			action: SocketCommandActionType.StreamDeckKeyAppear,
			data: {
				id: action.id,
				deviceId: 'companion-surface',
				coordinates: coords,
				settings: action.options,
				visible: true,
			},
		})
	}

	private sendActionDisappear(action: CompanionActionInfo): void {
		const coords = this.getCoordinatesFromAction(action) || { row: 0, column: 0 }
		this.broadcast({
			type: SocketCommandType.Event,
			action: SocketCommandActionType.StreamDeckKeyDisappear,
			data: {
				id: action.id,
				deviceId: 'companion-surface',
				coordinates: coords,
				settings: action.options,
				visible: false,
			},
		})
	}

	private getCoordinatesFromAction(action: CompanionActionInfo): { row: number; column: number } | null {
		const controlId = action.controlId
		const cachedLoc = this.state.getControlLocation(controlId)
		if (cachedLoc) return cachedLoc

		const match = controlId.match(/bank:(\d+):(\d+)/)
		if (match) {
			const buttonNum = parseInt(match[2]) - 1
			return { row: Math.floor(buttonNum / 8), column: buttonNum % 8 }
		}

		const sMatch = controlId.match(/surface:[^:]+:(\d+):(\d+)/)
		if (sMatch) return { row: parseInt(sMatch[1]), column: parseInt(sMatch[2]) }

		return null
	}

	private streamAvailableActions(ws: WebSocket): void {
		this.log('info', `Streaming active actions to client...`)
		for (const action of this.activeActions.values()) {
			if (action.actionId === 'toggle_mic') {
				const coords = this.getCoordinatesFromAction(action)
				if (coords) {
					ws.send(
						JSON.stringify({
							type: SocketCommandType.Event,
							action: SocketCommandActionType.StreamDeckKeyAppear,
							data: {
								id: action.id,
								deviceId: 'companion-surface',
								coordinates: coords,
								settings: action.options,
								visible: true,
							},
						}),
					)
				}
			}
		}
	}

	private findNonAllocatedVisibleAction(): any | null {
		// Visible actions for us are all toggle_mic actions that are currently "appearing"
		const visibleActions = Array.from(this.activeActions.values()).filter((action) => action.actionId === 'toggle_mic')

		if (visibleActions.length === 0) return null

		const allocatedActionIds = new Set(Object.values(this.state.meetingIdActionIdMap))

		const nonAllocatedVisibleActions = visibleActions.filter((action) => !allocatedActionIds.has(action.id))

		if (nonAllocatedVisibleActions.length === 0) return null

		if (nonAllocatedVisibleActions.length > 1) {
			nonAllocatedVisibleActions.sort((a, b) => {
				const c1 = this.getCoordinatesFromAction(a) || { row: 0, column: 0 }
				const c2 = this.getCoordinatesFromAction(b) || { row: 0, column: 0 }
				if (c1.row !== c2.row) return c1.row - c2.row
				return c1.column - c2.column
			})
		}

		const picked = nonAllocatedVisibleActions[0]
		const pickedCoords = this.getCoordinatesFromAction(picked)

		if (!pickedCoords) {
			this.log('warn', `Could not get coordinates for action ${picked.id}, controlId: ${picked.controlId}`)
			return null
		}

		this.log('debug', `Suggesting free action ${picked.id} at row:${pickedCoords.row}, col:${pickedCoords.column}`)

		return {
			id: picked.id,
			coordinates: pickedCoords,
			visible: true,
		}
	}

	public broadcast(command: SocketCommand): void {
		const msg = JSON.stringify(command)
		for (const client of this.clients) {
			if (client.readyState === WebSocket.OPEN) client.send(msg)
		}
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}
	updateActions(): void {
		UpdateActions(this)
	}
	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}
	updatePresets(): void {
		UpdatePresets(this)
	}
	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}
}

runEntrypoint(ModuleInstance, UpgradeScripts)
