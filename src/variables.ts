import type { ModuleInstance } from './main.js'

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const variables = []
	variables.push({ variableId: 'module_version', name: 'Module Version' })
	for (let i = 1; i <= 10; i++) {
		variables.push({ variableId: `room_${i}_name`, name: `Room ${i} Name` })
		variables.push({ variableId: `room_${i}_status`, name: `Room ${i} Status` })
	}
	self.setVariableDefinitions(variables)
}
