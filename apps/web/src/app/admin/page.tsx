import { listUsers } from '@eduforge/core';
import { RoleEditor } from '@/components/RoleEditor';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const admin = await requirePageRole('admin');
  const users = await listUsers(getDb(), admin);
  return (
    <div className="card">
      <h1>Користувачі та ролі</h1>
      <table>
        <thead>
          <tr>
            <th>Імʼя</th>
            <th>Email</th>
            <th>Ролі</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.displayName}</td>
              <td>{u.email}</td>
              <td>
                <RoleEditor userId={u.id} roles={u.roles} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
