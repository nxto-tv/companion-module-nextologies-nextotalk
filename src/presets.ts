import type { ModuleInstance } from './main.js'
import { CompanionPresetDefinitions, combineRgb } from '@companion-module/base'

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions = {}

	presets['toggle_mic'] = {
		type: 'button',
		category: 'Meetings',
		name: 'Toggle Mic (Custom)',
		style: {
			text: 'Idle',
			size: 'auto',
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(0, 0, 0),
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'toggle_mic',
						options: {},
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'mic_status',
				options: {
					roomNumber: 0,
				},
			},
		],
	}

	self.setPresetDefinitions(presets)
}
