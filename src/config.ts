import { type SomeCompanionConfigField } from '@companion-module/base'

export interface ModuleConfig {
	port: number
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'number',
			id: 'port',
			label: 'WebSocket Port',
			width: 4,
			min: 1,
			max: 65535,
			default: 7005,
		},
	]
}
