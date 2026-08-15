import { verifyTokenWithLog, type TokenPayload } from './_auth';
import { getRequestContext } from '../../lib/deny-tracker';
import { getSettings, getUserPermissions, type GlobalSettings, type UserPermissions } from '../../lib/users';
import { canModifyMgOperation, canViewMgOperation } from '../../lib/mg-permissions';

export interface MgAuthContext {
    user: TokenPayload;
    permissions: UserPermissions;
    settings: GlobalSettings;
}

export async function getMgAuthContext(request: Request): Promise<MgAuthContext | null> {
    const ctx = getRequestContext(request);
    const user = verifyTokenWithLog(request.headers.get('authorization') || undefined, ctx);
    if (!user) return null;

    const [permissions, settings] = await Promise.all([
        getUserPermissions(user.username, user.role),
        getSettings(),
    ]);

    return { user, permissions, settings };
}

export function canMgView(auth: MgAuthContext, operationKey: string): boolean {
    return canViewMgOperation(auth.user.role, auth.permissions, auth.settings.mgRiskLabels, operationKey);
}

export function canMgModify(auth: MgAuthContext, operationKey: string): boolean {
    return canModifyMgOperation(auth.user.role, auth.permissions, auth.settings.mgRiskLabels, operationKey);
}


