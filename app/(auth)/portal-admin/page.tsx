import { staff } from '@/lib/portal/store'
import PortalAdmin from './portal-admin'
export const dynamic='force-dynamic'
export default async function Page(){await staff();return <PortalAdmin/>}
