const ROLE_ALIASES = {
    text_vetter: 'checker',
    audio_vetter: 'audio_checker'
}

const ROLE_GROUPS = {
    checker: ['checker', 'text_vetter'],
    audio_checker: ['audio_checker', 'audio_vetter']
}

const normalizeRole = (role) => {
    const normalized = String(role || '').trim().toLowerCase()
    return ROLE_ALIASES[normalized] || normalized
}

const getRoleQueryValues = (role) => {
    const canonical = normalizeRole(role)
    return ROLE_GROUPS[canonical] || [canonical]
}

module.exports = {
    normalizeRole,
    getRoleQueryValues
}
