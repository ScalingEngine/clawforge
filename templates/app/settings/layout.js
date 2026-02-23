import { auth } from '../../lib/auth/index.js';
import { SettingsLayout } from '../../lib/chat/components/index.js';

export default async function Layout({ children }) {
  const session = await auth();
  return <SettingsLayout session={session}>{children}</SettingsLayout>;
}
