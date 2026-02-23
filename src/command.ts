export type SocketCommand = {
	type: SocketCommandType
	action: SocketCommandActionType
	data: any
	client?: string
	rooms?: any[]
}

export enum SocketCommandType {
	Request = 'request',
	Response = 'response',
	Event = 'event',
}

export enum SocketCommandActionType {
	Welcome = 'welcome',
	Join = 'join',
	Reset = 'reset',
	ClientDisconnected = 'client_disconnected',
	GetMicControllerKeys = 'get_mic_controller_keys',
	GetStreamDeckDevices = 'get_sd_devices',
	StreamDeckKeyAppear = 'sd_key_appear',
	StreamDeckKeyDisappear = 'sd_key_disappear',
	StreamDeckGlobalSettings = 'sd_global_settings',
	MapMeetingRoomToKey = 'map_meeting_room_to_key',
	MapSDKeyToRoom = 'map_sdkey_to_room',
	UpdateMicStatus = 'update_mic_status',
	ActionUpdated = 'action_updated',
	ToggleMic = 'toggle_mic',
	ActionRemoved = 'action_removed',
	ReleaseKey = 'release_key',
	UpdateRoomName = 'update_room_name',
	PersistedRoomMeta = 'persisted_room_meta',
	NextoTalkRooms = 'nextotalk_rooms',
	ParticipantAudioMuted = 'participant_audio_muted',
	ParticipantAudioUnmuted = 'participant_audio_unmuted',
	ParticipantBusyStatus = 'participant_busy_status',
	RoomActivityIndicatorEnabledStatus = 'room_activity_indicator_enabled_status',
	AllocateRoom = 'allocate_room',
	RoomAllocated = 'room_allocated',
}

export type RoomMeta = {
	roomName?: string
	roomNumber: number
	sdKeyId: string
}
