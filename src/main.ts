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

// Bump on every build so you can confirm the running module matches your build.
// Keep in sync with package.json / companion/manifest.json.
const MODULE_VERSION = '0.3.0'

function toBool(val: any): boolean {
	if (typeof val === 'boolean') return val
	if (val === 'true' || val === 1 || val === '1') return true
	return false
}

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
		this.log('info', `Initializing Nextotalk Module v${MODULE_VERSION}`)
		this.config = config
		this.updateStatus(InstanceStatus.Ok, `v${MODULE_VERSION}`)
		this.initWebSocketServer()
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.setVariableValues({ module_version: MODULE_VERSION })
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
		try {
			this.wss = new WebSocketServer({ port })
			this.updateStatus(InstanceStatus.Ok, `v${MODULE_VERSION} · :${port}`)
			this.log('info', `WebSocket Server started on port ${port}`)

			this.wss.on('connection', (ws) => {
				this.clients.add(ws)
				this.log('info', 'Client Connected to WebSocket Server')

				const welcomePayload: SocketCommand = {
					type: SocketCommandType.Event,
					action: SocketCommandActionType.Welcome,
					data: { version: '1.0.0.0-companion', pluginType: 'bitfocus' },
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

			this.wss.on('error', (err) => {
				this.log('error', `WebSocket Server Error: ${err.message}`)
				this.updateStatus(InstanceStatus.ConnectionFailure, `WS Error: ${err.message}`)
			})
		} catch (e: any) {
			this.log('error', `Failed to start WebSocket Server: ${e.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, `Port ${port} in use?`)
		}
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
				let meetingId = command.data.meetingId
				if (meetingId !== undefined && meetingId !== null) {
					meetingId = String(meetingId)
				}
				const sdKeyId = command.data.sdKeyId
				const coordinates = command.data.coordinates

				if (meetingId !== undefined) this.state.mapActionToMeeting(sdKeyId, meetingId)
				if (coordinates) {
					this.state.setControlLocation(sdKeyId, coordinates.row, coordinates.column)
					this.checkActionPositionUpdate(sdKeyId)
				}
				break
			}
			case SocketCommandActionType.MapMeetingRoomToKey: {
				const { sdKeyId, roomNumber, roomName, silentMap, isMuted, isBusy, isParticipantSpeaking } = command.data
				let meetingId = command.data.meetingId

				if (meetingId !== undefined && meetingId !== null) {
					meetingId = String(meetingId)
				}

				// Assignment is handled by mapActionToMeeting
				this.state.mapActionToMeeting(sdKeyId, meetingId)

				if (silentMap) {
					break
				}

				this.log('info', `Mapping meeting ${meetingId} to action ${sdKeyId}`)

				if (roomNumber !== undefined && roomNumber !== null && Number(roomNumber) > 0) {
					this.state.meetingRoomNumberMap[meetingId] = Number(roomNumber)
				}

				this.state.setMeetingActive(meetingId, true)

				// Update memory state
				this.state.updateMicStatus(
					meetingId,
					isMuted !== undefined ? toBool(isMuted) : (this.state.meetingMicStatusMap[meetingId] ?? true),
					isBusy !== undefined ? toBool(isBusy) : (this.state.meetingBusyStatusMap[meetingId] ?? false),
					isParticipantSpeaking !== undefined
						? toBool(isParticipantSpeaking)
						: (this.state.meetingSpeakingStatusMap[meetingId] ?? false),
				)

				const meetingTitle = (roomName ?? meetingId) as string
				if (meetingTitle) {
					this.state.updateRoomName(meetingId, this.lineBreakedMeetingTitle(meetingTitle))
				}

				this.log(
					'debug',
					`State after mapping: roomNumber=${this.state.meetingRoomNumberMap[meetingId]}, name=${this.state.meetingIdTitleMap[meetingId]}`,
				)

				this.notifyServerAboutSettingsChange(sdKeyId, meetingId)
				this.checkFeedbacks('mic_status')
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
			case SocketCommandActionType.RoomAllocated: {
				// The central brain (Chrome Extension) just told us a room was allocated.
				// We just need to ensure our local state is updated to reflect this.
				const data = command.data
				const meetingId = String(data.meetingId)

				this.state.meetingRoomNumberMap[meetingId] = data.serialNumber
				if (data.roomName) {
					this.state.updateRoomName(meetingId, this.lineBreakedMeetingTitle(data.roomName))
				}

				if (data.suggestedSDKey) {
					this.state.mapActionToMeeting(data.suggestedSDKey.id, meetingId)
				}

				this.state.setMeetingActive(meetingId, true)
				this.checkFeedbacks('mic_status')

				// Broadcast this allocation to other potential clients (like the Dashboard)
				this.broadcast(command)
				break
			}
			case SocketCommandActionType.UpdateMicStatus: {
				let meetingId = command.data.meetingId
				if (meetingId !== undefined && meetingId !== null) {
					meetingId = String(meetingId)
				}
				const { isMuted, isBusy, isParticipantSpeaking, roomName, sdKeyId } = command.data

				// Establish the action↔meeting mapping from the live status itself. The extension
				// includes the sdKeyId (= our action id) with every update_mic_status, so the surface
				// learns/refreshes which button drives which room — no auto-allocation needed, and it
				// self-heals after a Companion restart (the app keeps streaming status).
				if (sdKeyId && meetingId) {
					this.state.mapActionToMeeting(sdKeyId, meetingId)
				}

				if (roomName) {
					this.state.updateRoomName(meetingId, this.lineBreakedMeetingTitle(roomName))
				}

				if (isMuted === undefined) {
					// No mic info available (e.g. the browser tab/meeting was closed) -
					// treat the key as neutral/inactive instead of defaulting to "unmuted" (green).
					this.log('info', `UpdateMicStatus for ${meetingId}: isMuted undefined -> marking inactive (neutral)`)
					this.state.setMeetingActive(meetingId, false)
				} else {
					this.log(
						'info',
						`UpdateMicStatus for ${meetingId}: muted=${isMuted}, busy=${isBusy}, speaking=${isParticipantSpeaking}`,
					)
					// A defined mic status means the room is live → mark it active so the key renders
					// its colour. The NextoTalk app sends this for every online room it owns.
					this.state.setMeetingActive(meetingId, true)
					this.state.updateMicStatus(meetingId, toBool(isMuted), toBool(isBusy), toBool(isParticipantSpeaking))
				}
				this.checkFeedbacks('mic_status')
				break
			}
			case SocketCommandActionType.ParticipantAudioMuted:
			case SocketCommandActionType.ParticipantAudioUnmuted:
			case SocketCommandActionType.ParticipantBusyStatus: {
				let meetingId = command.data.meetingId
				if (meetingId !== undefined && meetingId !== null) {
					meetingId = String(meetingId)
				}
				const { isMuted, isBusy, isParticipantSpeaking } = command.data
				this.log(
					'info',
					`Participant Status Event for ${meetingId}: muted=${isMuted}, busy=${isBusy}, speaking=${isParticipantSpeaking}`,
				)
				this.state.updateMicStatus(meetingId, toBool(isMuted), toBool(isBusy), toBool(isParticipantSpeaking))
				this.checkFeedbacks('mic_status')
				break
			}
			case SocketCommandActionType.NextoTalkRooms: {
				if (Array.isArray(command.rooms)) {
					for (const room of command.rooms) {
						let meetingId = room.meetingId
						if (meetingId !== undefined && meetingId !== null) {
							meetingId = String(meetingId)
						}

						if (meetingId) {
							this.state.setMeetingActive(meetingId, true)
							this.state.updateMicStatus(
								meetingId,
								toBool(room.isMuted),
								toBool(room.isBusy),
								toBool(room.isParticipantSpeaking),
							)
						}
					}
					this.checkFeedbacks('mic_status')
				}
				break
			}
			case SocketCommandActionType.UpdateRoomName: {
				let meetingId = command.data.meetingId
				if (meetingId !== undefined && meetingId !== null) {
					meetingId = String(meetingId)
				}
				const { roomName } = command.data
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
			case SocketCommandActionType.ReleaseKey: {
				let meetingId = command.data.meetingId
				if (meetingId !== undefined && meetingId !== null) {
					meetingId = String(meetingId)
				}
				this.state.setMeetingActive(meetingId, false)

				this.log('info', `Meeting set to inactive: ${meetingId}`)
				this.checkFeedbacks('mic_status')

				// Send acknowledgment response if it was a request
				if (command.type === SocketCommandType.Request) {
					ws.send(
						JSON.stringify({
							type: SocketCommandType.Response,
							action: SocketCommandActionType.ReleaseKey,
							data: { meetingId, success: true },
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

	public async discoverActionCoordinates(
		controlId: string,
		context: { parseVariablesInString(text: string): Promise<string> },
	): Promise<void> {
		try {
			// We ask Companion to resolve $(this:row/column) for this specific button instance
			const rowStr = await context.parseVariablesInString('$(this:row)')
			const colStr = await context.parseVariablesInString('$(this:column)')

			const dRow = parseInt(rowStr)
			const dCol = parseInt(colStr)

			if (!isNaN(dRow) && !isNaN(dCol)) {
				const current = this.state.getControlLocation(controlId)
				if (!current || current.row !== dRow || current.column !== dCol) {
					this.log('info', `Coordinate discovered for ${controlId}: row=${dRow}, col=${dCol}`)
					this.state.setControlLocation(controlId, dRow, dCol)
					this.checkActionPositionUpdate(controlId)
				}
			} else {
				this.log('info', `Invalid coordinates parsed for ${controlId}: row=${rowStr}, col=${colStr}`)
			}
		} catch (e) {
			this.log('info', `Coordinate discovery failed for ${controlId}: ${e}`)
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

	private lineBreakedMeetingTitle(title: string): string {
		if (!title) return ''
		const words = title.split(' ')
		if (words.length <= 1) return title

		const mid = Math.ceil(words.length / 2)
		return words.slice(0, mid).join(' ') + '\n' + words.slice(mid).join(' ')
	}

	private notifyServerAboutSettingsChange(sdKeyId: string, meetingId: string): void {
		const info = this.state.getRoomInfoForMeeting(meetingId)
		if (!info) return

		const settings = {
			isEnabled: true,
			isMuted: info.isMuted,
			meetingId: meetingId,
			roomNumber: info.roomNumber,
			isUserBusy: info.isBusy,
			isParticipantSpeaking: info.isSpeaking,
			title: info.name,
		}

		this.broadcast({
			type: SocketCommandType.Event,
			action: SocketCommandActionType.ActionUpdated,
			data: {
				sdkey: sdKeyId,
				settings: settings,
			},
		})
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
