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

				if (meetingId && roomInfo) {
					// Optimistically toggle the local status first for instant feedback
					const newMutedState = !roomInfo.isMuted
					self.state.updateMicStatus(meetingId, newMutedState)
					self.checkFeedbacks('mic_status')

					self.log('info', `Toggling mic for ${meetingId} (New state: ${newMutedState ? 'Muted' : 'Unmuted'})`)
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
			subscribe: async (action, context) => {
				self.log('debug', `Action Subscribe: ${JSON.stringify(action)}`)
				// Discover coordinates immediately so sd_key_appear can be broadcast
				// without waiting for the feedback callback to run (which only happens
				// while the button is being rendered somewhere).
				await self.discoverActionCoordinates(action.controlId, context)
				self.onActionAppearance(action, true)
			},
			unsubscribe: (action) => {
				self.log('debug', `Action Unsubscribe: ${JSON.stringify(action)}`)
				self.onActionAppearance(action, false)
			},
		},
	})
}
