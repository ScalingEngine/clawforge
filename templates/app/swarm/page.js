import { auth } from '../../lib/auth/index.js';
import { SwarmPage } from '../../lib/chat/components/index.js';

export default async function SwarmRoute() {
  const session = await auth();
  return <SwarmPage session={session} />;
}
