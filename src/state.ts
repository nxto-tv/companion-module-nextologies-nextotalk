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
	public meetingBusyStatusMap: Record<string, boolean> = {}
	public meetingSpeakingStatusMap: Record<string, boolean> = {}

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

	public getSerialNumberForMeeting(meetingId: unknown): number | null {
		const mId = typeof meetingId === 'string' || typeof meetingId === 'number' ? String(meetingId) : ''
		if (!mId) return null

		const existingSerialNumber = this.meetingRoomNumberMap[mId]
		if (existingSerialNumber) return existingSerialNumber

		const nextSerialNumber = Object.values(this.meetingRoomNumberMap).length + 1
		if (nextSerialNumber <= this.maximumMeetingsAllowed) {
			this.meetingRoomNumberMap[mId] = nextSerialNumber
			return nextSerialNumber
		}
		return null
	}

	public mapActionToMeeting(actionId: string, meetingId: unknown): void {
		const mId = typeof meetingId === 'string' || typeof meetingId === 'number' ? String(meetingId) : null
		if (mId) {
			// Clear existing mapping for this meeting if it exists elsewhere
			const oldActionId = this.meetingIdActionIdMap[mId]
			if (oldActionId) {
				delete this.actionIdMeetingIdMap[oldActionId]
			}

			this.actionIdMeetingIdMap[actionId] = mId
			this.meetingIdActionIdMap[mId] = actionId
		} else {
			// Unmap
			const oldMeetingId = this.actionIdMeetingIdMap[actionId]
			if (oldMeetingId) {
				delete this.meetingIdActionIdMap[oldMeetingId]
			}
			delete this.actionIdMeetingIdMap[actionId]
		}
	}

	public updateRoomName(meetingId: unknown, name: string): void {
		const mId = typeof meetingId === 'string' || typeof meetingId === 'number' ? String(meetingId) : ''
		if (!mId) return
		this.meetingIdTitleMap[mId] = name
	}

	public updateMicStatus(meetingId: unknown, isMuted: boolean, isBusy?: boolean, isSpeaking?: boolean): void {
		const mId = typeof meetingId === 'string' || typeof meetingId === 'number' ? String(meetingId) : ''
		if (!mId) return
		this.meetingMicStatusMap[mId] = isMuted
		if (isBusy !== undefined) this.meetingBusyStatusMap[mId] = isBusy
		if (isSpeaking !== undefined) this.meetingSpeakingStatusMap[mId] = isSpeaking
	}

	public getMeetingIdForAction(actionId: string): string | null {
		const mId = this.actionIdMeetingIdMap[actionId]
		return mId !== undefined ? String(mId) : null
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

	public getRoomInfoForMeeting(meetingId: unknown): {
		name: string
		isMuted: boolean
		isBusy: boolean
		isSpeaking: boolean
		roomNumber: number
		isActive: boolean
	} | null {
		const mId = typeof meetingId === 'string' || typeof meetingId === 'number' ? String(meetingId) : ''
		if (!mId) return null

		const roomNumber = this.meetingRoomNumberMap[mId]
		if (roomNumber === undefined || roomNumber === null) return null

		return {
			name: this.meetingIdTitleMap[mId] || mId,
			isMuted: this.meetingMicStatusMap[mId] ?? true,
			isBusy: this.meetingBusyStatusMap[mId] ?? false,
			isSpeaking: this.meetingSpeakingStatusMap[mId] ?? false,
			roomNumber: roomNumber,
			isActive: this.activeMeetings.has(mId),
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
		this.meetingBusyStatusMap = {}
		this.meetingSpeakingStatusMap = {}
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
		delete this.meetingBusyStatusMap[meetingId]
		delete this.meetingSpeakingStatusMap[meetingId]
		this.activeMeetings.delete(meetingId)
	}
}
