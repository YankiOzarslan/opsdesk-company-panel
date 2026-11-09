'use strict';
function myTeam(db, account) {
  return db.all('SELECT * FROM team_members WHERE user_id = ? OR (user_id IS NULL AND lower(email) = ?)', [account.id, account.email.toLowerCase()]);
}
function projectIds(db, account, scope = 'all') {
  if (account.role === 'admin' && scope === 'all') return null;
  const mine = myTeam(db, account);
  const teamIds = new Set(mine.map(t => t.id));
  if (scope !== 'mine') {
    const roles = new Set(mine.map(t => (t.job_role || '').trim().toLocaleLowerCase('tr-TR')).filter(Boolean));
    for (const t of db.all('SELECT id, job_role FROM team_members')) {
      if (roles.has((t.job_role || '').trim().toLocaleLowerCase('tr-TR'))) teamIds.add(t.id);
    }
  }
  const assigned = db.all('SELECT project_id, team_member_id FROM project_assignments').filter(a => teamIds.has(a.team_member_id)).map(a => a.project_id);
  for (const p of db.all('SELECT id FROM projects WHERE created_by = ?', [account.email])) assigned.push(p.id);
  return new Set(assigned);
}
function canEditProject(db, account, project) {
  if (account.role === 'admin' || project.created_by === account.email) return true;
  return projectIds(db, account, 'mine').has(project.id);
}
function canReveal(db, account, entity, id) {
  if (account.role === 'admin') return true;
  const mine = new Set(myTeam(db, account).map(t => t.id));
  if (!mine.size) return false;
  if (entity === 'servers') {
    const server = db.get('SELECT manager_team_id FROM servers WHERE id = ?', [id]);
    if (server && mine.has(server.manager_team_id)) return true;
  }
  const resource = entity === 'domains' ? 'domain_id' : 'server_id';
  return db.all(`SELECT a.team_member_id FROM project_assignments a JOIN projects p ON p.id = a.project_id WHERE p.${resource} = ?`, [id]).some(a => mine.has(a.team_member_id));
}
function deny(message = 'Bu işlem için yetkiniz yok.') { const error = new Error(message); error.status = 403; return error; }
module.exports = { myTeam, projectIds, canEditProject, canReveal, deny };
