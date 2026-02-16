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
				try {
					// We ask Companion to resolve $(this:row/column) for this specific button instance
					const rowStr = await context.parseVariablesInString('$(this:row)')
					const colStr = await context.parseVariablesInString('$(this:column)')

					const dRow = parseInt(rowStr)
					const dCol = parseInt(colStr)

					if (!isNaN(dRow) && !isNaN(dCol)) {
						const current = self.state.getControlLocation(feedback.controlId)
						if (!current || current.row !== dRow || current.column !== dCol) {
							self.log('info', `Coordinate discovered for ${feedback.controlId}: row=${dRow}, col=${dCol}`)
							self.state.setControlLocation(feedback.controlId, dRow, dCol)
							self.checkActionPositionUpdate(feedback.controlId)
						}
					} else {
						self.log('info', `Invalid coordinates parsed for ${feedback.controlId}: row=${rowStr}, col=${colStr}`)
					}
				} catch (e) {
					self.log('info', `Coordinate discovery failed for ${feedback.controlId}: ${e}`)
				}

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
							`Meeting ${meetingId} (${info.name}) is active, muted=${info.isMuted}, room=${info.roomNumber}`,
						)
						return {
							bgcolor: info.isMuted ? combineRgb(255, 0, 0) : combineRgb(0, 200, 0),
							color: combineRgb(255, 255, 255),
							text: info.name,
							png64: info.isMuted ? MUTE_KEY_PNG : UNMUTE_KEY_PNG,
						}
					} else {
						self.log('info', `No room info found for meetingId ${meetingId}`)
					}
				}

				self.log('info', `Returning default empty feedback for controlId ${feedback.controlId}`)
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
