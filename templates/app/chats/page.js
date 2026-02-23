import { auth } from 'clawforge/auth';
import { ChatsPage } from 'clawforge/chat';

export default async function ChatsRoute() {
  const session = await auth();
  return <ChatsPage session={session} />;
}
