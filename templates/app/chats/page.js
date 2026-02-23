import { auth } from '../../lib/auth/index.js';
import { ChatsPage } from '../../lib/chat/components/index.js';

export default async function ChatsRoute() {
  const session = await auth();
  return <ChatsPage session={session} />;
}
