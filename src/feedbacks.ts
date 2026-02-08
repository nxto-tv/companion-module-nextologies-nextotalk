import { combineRgb } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import { EMPTY_KEY_PNG, MUTE_KEY_PNG, UNMUTE_KEY_PNG } from './assets.js'

export function UpdateFeedbacks(self: ModuleInstance): void {
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
							// Using 'debug' to avoid flooding, but it works!
							self.state.setControlLocation(feedback.controlId, dRow, dCol)
							self.checkActionPositionUpdate(feedback.controlId)
						}
					}
				} catch (_e) {
					// Silicon discovery failed, fallback to key parsing in main.ts
				}

				// 2. STATUS RENDERING
				const roomNumberSetting = Number(feedback.options.roomNumber)
				let meetingId: string | null = null

				if (roomNumberSetting > 0) {
					for (const [id, num] of Object.entries(self.state.meetingRoomNumberMap)) {
						if (num === roomNumberSetting) {
							meetingId = id
							break
						}
					}
				} else {
					const actionId = self.controlIdToActionId.get(feedback.controlId)
					if (actionId) {
						meetingId = self.state.getMeetingIdForAction(actionId)
					}
				}

				if (meetingId) {
					const info = self.state.getRoomInfoForMeeting(meetingId)
					if (info) {
						return {
							bgcolor: info.isMuted ? combineRgb(255, 0, 0) : combineRgb(0, 200, 0),
							color: combineRgb(255, 255, 255),
							text: '',
							png64: info.isMuted ? MUTE_KEY_PNG : UNMUTE_KEY_PNG,
						}
					}
				}

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
