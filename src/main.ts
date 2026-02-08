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
