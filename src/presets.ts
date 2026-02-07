import type { ModuleInstance } from './main.js'
import { CompanionPresetDefinitions, combineRgb } from '@companion-module/base'

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions = {}
	presets['mylabel'] = {
		type: 'button',
		category: 'Group One',
		name: 'Name',
		style: {
			text: 'My first Preset button',
			size: 'auto',
			color: combineRgb(30, 30, 30),
			bgcolor: combineRgb(255, 255, 255),
			show_topbar: true,
		},
		steps: [],
		feedbacks: [],
	}

	self.setPresetDefinitions(presets)
}
