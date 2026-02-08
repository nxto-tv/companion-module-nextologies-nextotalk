import { SocketCommandActionType, SocketCommandType } from './command.js'
import type { ModuleInstance } from './main.js'

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		toggle_mic: {
			name: 'Toggle Microphone',
			options: [],
			callback: async (event) => {
				const meetingId = self.state.getMeetingIdForAction(event.id)
				const roomInfo = meetingId ? self.state.getRoomInfoForMeeting(meetingId) : null

				if (roomInfo) {
					self.broadcast({
						type: SocketCommandType.Request,
						action: SocketCommandActionType.ToggleMic,
						data: {
							roomNumber: roomInfo.roomNumber,
							meetingId: meetingId,
						},
					})
				} else {
					self.log('warn', `Action ${event.id} is not mapped to any room.`)
				}
			},
			subscribe: (action) => {
				self.log('debug', `Action Subscribe: ${JSON.stringify(action)}`)
				self.onActionAppearance(action, true)
			},
			unsubscribe: (action) => {
				self.log('debug', `Action Unsubscribe: ${JSON.stringify(action)}`)
				self.onActionAppearance(action, false)
			},
		},
	})
}
