import { auth } from 'clawforge/auth';
import { NotificationsPage } from 'clawforge/chat';

export default async function NotificationsRoute() {
  const session = await auth();
  return <NotificationsPage session={session} />;
}
