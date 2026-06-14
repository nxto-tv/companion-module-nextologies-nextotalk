import { combineRgb } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import { EMPTY_KEY_PNG, MUTE_KEY_PNG, UNMUTE_KEY_PNG } from './assets.js'

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.log('info', 'Updating feedback definitions')
	self.setFeedbackDefinitions({
		mic_status: {
			name: 'Microphone Status',
			type: 'advanced',
			options: [
				{
					id: 'roomNumber',
					type: 'number',
					label: 'Room Number (0 for Auto/None)',
					default: 0,
					min: 0,
					max: 100,
				},
			],
			callback: async (feedback, context) => {
				self.log('info', `Feedback callback triggered for controlId: ${feedback.controlId}`)
				// 1. DYNAMIC COORDINATE DISCOVERY (The "Top Bar" Grabber)
				await self.discoverActionCoordinates(feedback.controlId, context)

				// 2. STATUS RENDERING
				const roomNumberSetting = Number(feedback.options.roomNumber)
				let meetingId: string | null = null

				if (roomNumberSetting > 0) {
					self.log('info', `Looking up meeting for room number: ${roomNumberSetting}`)
					for (const [id, num] of Object.entries(self.state.meetingRoomNumberMap)) {
						if (num === roomNumberSetting) {
							meetingId = id
							self.log('info', `Found meetingId ${meetingId} for room number ${roomNumberSetting}`)
							break
						}
					}
					if (!meetingId) {
						self.log('info', `No meeting found for room number ${roomNumberSetting}`)
					}
				} else {
					const actionId = self.controlIdToActionId.get(feedback.controlId)
					if (actionId) {
						meetingId = self.state.getMeetingIdForAction(actionId)
						self.log('info', `Auto mode: actionId ${actionId} mapped to meetingId ${meetingId}`)
					} else {
						self.log('info', `Auto mode: no actionId found for controlId ${feedback.controlId}`)
					}
				}

				if (meetingId) {
					const info = self.state.getRoomInfoForMeeting(meetingId)
					if (info) {
						if (!info.isActive) {
							self.log('info', `Meeting ${meetingId} (${info.name}) is inactive`)
							return {
								bgcolor: combineRgb(0, 0, 0),
								color: combineRgb(100, 100, 100),
								text: info.name,
								png64: EMPTY_KEY_PNG,
							}
						}
						self.log(
							'info',
							`FEEDBACK STATUS [${meetingId}]: Muted=${info.isMuted} (${info.isMuted ? 'RED' : 'GREEN'}), Busy=${info.isBusy}, Speaking=${info.isSpeaking}, Active=${info.isActive}`,
						)

						// Priority: Busy (Orange) > Speaking (Blue) > Muted (Red) > Unmuted (Green)
						let bgcolor = info.isMuted ? combineRgb(255, 0, 0) : combineRgb(0, 200, 0)
						const png64 = info.isMuted ? MUTE_KEY_PNG : UNMUTE_KEY_PNG

						if (info.isBusy) {
							bgcolor = combineRgb(255, 166, 0) // Orange
						} else if (info.isSpeaking) {
							bgcolor = combineRgb(17, 65, 211) // Blue
						}

						return {
							bgcolor,
							color: combineRgb(255, 255, 255),
							text: info.name,
							png64,
						}
					} else {
						const allAllocated = Object.keys(self.state.meetingRoomNumberMap).join(', ')
						self.log('warn', `No room info found for meetingId [${meetingId}]. Available: ${allAllocated}`)
					}
				}

				self.log('debug', `Returning default feedback for controlId ${feedback.controlId}`)
				return {
					bgcolor: combineRgb(0, 0, 0),
					color: combineRgb(100, 100, 100),
					text: '',
					png64: EMPTY_KEY_PNG,
				}
			},
		},
	})
}
