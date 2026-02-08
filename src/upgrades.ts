import type {
	CompanionStaticUpgradeScript,
	CompanionUpgradeContext,
	CompanionStaticUpgradeProps,
	CompanionStaticUpgradeResult,
} from '@companion-module/base'
import type { ModuleConfig } from './config.js'

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [
	// Upgrade 1: Add discovery options to existing mic_status feedbacks
	function (
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig>,
	): CompanionStaticUpgradeResult<ModuleConfig> {
		const result: CompanionStaticUpgradeResult<ModuleConfig> = {
			updatedConfig: null,
			updatedActions: [],
			updatedFeedbacks: [],
		}

		for (const feedback of props.feedbacks) {
			if (feedback.feedbackId === 'mic_status') {
				let changed = false
				if (feedback.options.discovery_row === undefined) {
					feedback.options.discovery_row = '$(this:row)'
					changed = true
				}
				if (feedback.options.discovery_col === undefined) {
					feedback.options.discovery_col = '$(this:column)'
					changed = true
				}
				if (changed) {
					result.updatedFeedbacks.push(feedback)
				}
			}
		}

		return result
	},
]
