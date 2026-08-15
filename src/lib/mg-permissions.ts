export type MgRole = 'admin' | 'manager' | 'guest';

export interface MgSectionPermissionValue {
    view?: number;
    modify?: number;
}

export interface MgPermissionSource {
    mgPermissions?: Record<string, MgSectionPermissionValue>;
}

/**
 * The risk labels are shared by the client and the API routes.  Settings only
 * stores overrides, so callers must merge overrides with this map before
 * checking an operation.
 */
export const DEFAULT_MG_RISK_LABELS: Record<string, number> = {
    'overview.viewStats': 1,
    'overview.viewOnlineUsers': 1,
    'overview.viewRecentActions': 1,
    'overview.viewRecentDeny': 2,
    'overview.switchDataSource': 2,
    'overview.switchPageSource': 2,
    'overview.viewPreviews': 1,
    'downloads.viewChannels': 1,
    'downloads.expandChannel': 1,
    'downloads.viewHistory': 2,
    'visits.viewIPs': 1,
    'visits.switchSort': 1,
    'visits.viewFlow': 1,
    'visits.banShort': 2,
    'visits.unban': 2,
    'visits.banCustom': 3,
    'actionlogs.viewTable': 1,
    'actionlogs.filter': 1,
    'actionlogs.exportCSV': 1,
    'announcements.viewStatus': 1,
    'announcements.viewHistory': 1,
    'announcements.publish': 2,
    'announcements.toggle': 2,
    'announcements.delete': 3,
    'fileperms.viewRules': 2,
    'fileperms.previewRegex': 2,
    'fileperms.editRules': 3,
    'fileperms.deleteRule': 3,
    'users.viewList': 2,
    'users.viewPerms': 2,
    'users.viewAssociations': 2,
    'users.editBasePath': 2,
    'users.addUser': 3,
    'users.changeRole': 4,
    'users.changePerms': 4,
    'users.deleteUser': 4,
    'riskcontrol.viewSummary': 3,
    'riskcontrol.viewEntities': 3,
    'riskcontrol.viewDetail': 3,
    'riskcontrol.viewDenyEvents': 3,
    'riskcontrol.adjustScore': 4,
    'riskcontrol.unban': 4,
    'riskcontrol.clearScore': 4,
    'settings.view': 2,
    'settings.appearance': 2,
    'settings.dataRetention': 2,
    'settings.global': 3,
    'settings.fileLimits': 3,
    'settings.loginLimits': 3,
    'settings.denyConfig': 4,
    'settings.changePassword': 6,
    'settings.riskLabels': 6,
    'emergency.view': 3,
    'emergency.maintenance': 5,
    'emergency.restore': 5,
    'emergency.banAllIPs': 5,
};

export const MG_SECTION_BY_PREFIX: Record<string, string> = {
    overview: 'mgOverview',
    downloads: 'mgDownloads',
    visits: 'mgVisits',
    actionlogs: 'mgActionLogs',
    announcements: 'mgAnnouncements',
    fileperms: 'mgFilePerms',
    users: 'mgUsers',
    riskcontrol: 'mgRiskControl',
    settings: 'mgSettings',
    emergency: 'mgEmergency',
};

const MG_OPERATION_KEYS = Object.keys(DEFAULT_MG_RISK_LABELS);

function normalizeLevel(value: unknown): number {
    const numberValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numberValue)) return 0;
    return Math.max(0, Math.min(6, Math.trunc(numberValue)));
}

export function getEffectiveMgRiskLabels(overrides?: Record<string, number>): Record<string, number> {
    const merged = { ...DEFAULT_MG_RISK_LABELS };
    if (!overrides || typeof overrides !== 'object') return merged;

    for (const [key, value] of Object.entries(overrides)) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_MG_RISK_LABELS, key)) {
            merged[key] = normalizeLevel(value);
        }
    }
    return merged;
}

export function getMgSectionForOperation(operationKey: string): string | null {
    const prefix = operationKey.split('.')[0];
    return MG_SECTION_BY_PREFIX[prefix] || null;
}

export function getMgRiskLevel(operationKey: string, overrides?: Record<string, number>): number | null {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_MG_RISK_LABELS, operationKey)) return null;
    return getEffectiveMgRiskLabels(overrides)[operationKey];
}

export function canViewMgOperation(
    role: MgRole | string,
    permissions: MgPermissionSource | null | undefined,
    riskOverrides: Record<string, number> | undefined,
    operationKey: string,
): boolean {
    if (role === 'admin') return true;
    const risk = getMgRiskLevel(operationKey, riskOverrides);
    const section = getMgSectionForOperation(operationKey);
    if (risk === null || risk >= 6 || !section) return false;
    const viewLevel = normalizeLevel(permissions?.mgPermissions?.[section]?.view);
    return viewLevel > 0 && viewLevel >= risk;
}

export function canModifyMgOperation(
    role: MgRole | string,
    permissions: MgPermissionSource | null | undefined,
    riskOverrides: Record<string, number> | undefined,
    operationKey: string,
): boolean {
    if (role === 'admin') return true;
    const risk = getMgRiskLevel(operationKey, riskOverrides);
    const section = getMgSectionForOperation(operationKey);
    if (risk === null || risk >= 6 || !section) return false;
    const modifyLevel = normalizeLevel(permissions?.mgPermissions?.[section]?.modify);
    return modifyLevel > 0 && modifyLevel >= risk;
}

export function canViewMgSection(
    role: MgRole | string,
    permissions: MgPermissionSource | null | undefined,
    riskOverrides: Record<string, number> | undefined,
    sectionKey: string,
): boolean {
    if (role === 'admin') return true;
    return MG_OPERATION_KEYS.some((operationKey) =>
        getMgSectionForOperation(operationKey) === sectionKey &&
        canViewMgOperation(role, permissions, riskOverrides, operationKey)
    );
}

export function hasAnyMgViewPermission(
    role: MgRole | string,
    permissions: MgPermissionSource | null | undefined,
    riskOverrides: Record<string, number> | undefined,
): boolean {
    if (role === 'admin') return true;
    return MG_OPERATION_KEYS.some((operationKey) =>
        canViewMgOperation(role, permissions, riskOverrides, operationKey)
    );
}

