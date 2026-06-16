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

	public mapActionToMeeting(actionId: string, meetingIdRaw: string | number | null): void {
		if (meetingIdRaw !== null && meetingIdRaw !== undefined) {
			const meetingId = String(meetingIdRaw)
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

	public updateRoomName(meetingIdRaw: string | number, name: string): void {
		const meetingId = String(meetingIdRaw)
		this.meetingIdTitleMap[meetingId] = name
	}

	public updateMicStatus(
		meetingIdRaw: string | number,
		isMuted: boolean,
		isBusy?: boolean,
		isSpeaking?: boolean,
	): void {
		const meetingId = String(meetingIdRaw)
		this.meetingMicStatusMap[meetingId] = isMuted
		if (isBusy !== undefined) this.meetingBusyStatusMap[meetingId] = isBusy
		if (isSpeaking !== undefined) this.meetingSpeakingStatusMap[meetingId] = isSpeaking
	}

	public getMeetingIdForAction(actionId: string): string | null {
		const mId = this.actionIdMeetingIdMap[actionId]
		return mId !== undefined ? String(mId) : null
	}

	// Active meetings (connected tabs)
	public activeMeetings: Set<string> = new Set()

	public setMeetingActive(meetingIdRaw: string | number, isActive: boolean): void {
		const meetingId = String(meetingIdRaw)
		if (isActive) {
			this.activeMeetings.add(meetingId)
		} else {
			this.activeMeetings.delete(meetingId)
		}
	}

	public getRoomInfoForMeeting(meetingIdRaw: string | number): {
		name: string
		isMuted: boolean
		isBusy: boolean
		isSpeaking: boolean
		roomNumber: number
		isActive: boolean
	} | null {
		const meetingId = String(meetingIdRaw)
		// A room is "known" if it is mapped to a key, has a title, or has a room number.
		// Do NOT gate on roomNumber — the NextoTalk app maps PL rooms with roomNumber 0, and a
		// mapped room must still render its name (the room number is optional metadata).
		const roomNumber = this.meetingRoomNumberMap[meetingId]
		const hasTitle = this.meetingIdTitleMap[meetingId] !== undefined
		const isMapped = this.meetingIdActionIdMap[meetingId] !== undefined
		if (roomNumber === undefined && !hasTitle && !isMapped) return null

		return {
			name: this.meetingIdTitleMap[meetingId] || meetingId,
			isMuted: this.meetingMicStatusMap[meetingId] ?? true,
			isBusy: this.meetingBusyStatusMap[meetingId] ?? false,
			isSpeaking: this.meetingSpeakingStatusMap[meetingId] ?? false,
			roomNumber: roomNumber ?? 0,
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
