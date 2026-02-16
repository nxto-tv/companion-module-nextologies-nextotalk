export interface MeetingInfo {
	meetingId: string
	roomType: string
	isMuted: boolean
	tabId?: string
	sdKeyId?: string
	instant?: boolean
	serialNumber?: number
	roomName?: string
}

export class ModuleState {
	// Mappings
	public meetingRoomNumberMap: Record<string, number> = {}
	public meetingIdTitleMap: Record<string, string> = {}
	public meetingMicStatusMap: Record<string, boolean> = {}

	// Action ID (Companion) to Meeting ID mapping
	public actionIdMeetingIdMap: Record<string, string> = {}
	public meetingIdActionIdMap: Record<string, string> = {} // Added this mapping
	// UID to Physical Position mapping
	public controlIdToLocationMap: Map<string, { row: number; column: number }> = new Map()

	public setControlLocation(controlId: string, row: number, column: number): void {
		this.controlIdToLocationMap.set(controlId, { row, column })
	}

	public getControlLocation(controlId: string): { row: number; column: number } | null {
		return this.controlIdToLocationMap.get(controlId) || null
	}

	private maximumMeetingsAllowed = 100

	public getSerialNumberForMeeting(meetingId: string): number | null {
		const existingSerialNumber = this.meetingRoomNumberMap[meetingId]
		if (existingSerialNumber) return existingSerialNumber

		const nextSerialNumber = Object.values(this.meetingRoomNumberMap).length + 1
		if (nextSerialNumber <= this.maximumMeetingsAllowed) {
			this.meetingRoomNumberMap[meetingId] = nextSerialNumber
			return nextSerialNumber
		}
		return null
	}

	public mapActionToMeeting(actionId: string, meetingId: string | null): void {
		if (meetingId) {
			// Clear existing mapping for this meeting if it exists elsewhere
			const oldActionId = this.meetingIdActionIdMap[meetingId]
			if (oldActionId) {
				delete this.actionIdMeetingIdMap[oldActionId]
			}

			this.actionIdMeetingIdMap[actionId] = meetingId
			this.meetingIdActionIdMap[meetingId] = actionId
		} else {
			// Unmap
			const oldMeetingId = this.actionIdMeetingIdMap[actionId]
			if (oldMeetingId) {
				delete this.meetingIdActionIdMap[oldMeetingId]
			}
			delete this.actionIdMeetingIdMap[actionId]
		}
	}

	public updateRoomName(meetingId: string, name: string): void {
		this.meetingIdTitleMap[meetingId] = name
	}

	public updateMicStatus(meetingId: string, isMuted: boolean): void {
		this.meetingMicStatusMap[meetingId] = isMuted
	}

	public getMeetingIdForAction(actionId: string): string | null {
		return this.actionIdMeetingIdMap[actionId] || null
	}

	// Active meetings (connected tabs)
	public activeMeetings: Set<string> = new Set()

	public setMeetingActive(meetingId: string, isActive: boolean): void {
		if (isActive) {
			this.activeMeetings.add(meetingId)
		} else {
			this.activeMeetings.delete(meetingId)
		}
	}

	public getRoomInfoForMeeting(meetingId: string): {
		name: string
		isMuted: boolean
		roomNumber: number
		isActive: boolean
	} | null {
		if (!this.meetingRoomNumberMap[meetingId]) return null
		return {
			name: this.meetingIdTitleMap[meetingId] || meetingId,
			isMuted: this.meetingMicStatusMap[meetingId] ?? true,
			roomNumber: this.meetingRoomNumberMap[meetingId],
			isActive: this.activeMeetings.has(meetingId),
		}
	}

	public getRoomByNumber(roomNumber: number): { name: string; isMuted: boolean } | null {
		for (const [meetingId, num] of Object.entries(this.meetingRoomNumberMap)) {
			if (num === roomNumber) {
				return {
					name: this.meetingIdTitleMap[meetingId] || meetingId,
					isMuted: this.meetingMicStatusMap[meetingId] ?? true,
				}
			}
		}
		return null
	}

	public reset(): void {
		this.meetingRoomNumberMap = {}
		this.meetingIdTitleMap = {}
		this.meetingMicStatusMap = {}
		this.actionIdMeetingIdMap = {}
		this.meetingIdActionIdMap = {}
		this.activeMeetings.clear()
		this.controlIdToLocationMap.clear()
	}

	public removeMeeting(meetingId: string): void {
		const actionId = this.meetingIdActionIdMap[meetingId]
		if (actionId) {
			delete this.actionIdMeetingIdMap[actionId]
			delete this.meetingIdActionIdMap[meetingId]
		} else {
			// Fallback: Scan for any actions mapped to this meetingId and remove them
			for (const [aId, mId] of Object.entries(this.actionIdMeetingIdMap)) {
				if (mId === meetingId) {
					delete this.actionIdMeetingIdMap[aId]
				}
			}
		}
		delete this.meetingRoomNumberMap[meetingId]
		delete this.meetingIdTitleMap[meetingId]
		delete this.meetingMicStatusMap[meetingId]
		this.activeMeetings.delete(meetingId)
	}
}
