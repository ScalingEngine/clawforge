import { auth } from '../../lib/auth/index.js';
import { NotificationsPage } from '../../lib/chat/components/index.js';

export default async function NotificationsRoute() {
  const session = await auth();
  return <NotificationsPage session={session} />;
}
