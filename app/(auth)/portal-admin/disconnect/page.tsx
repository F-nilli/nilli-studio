import { staff } from '@/lib/portal/store'
import Disconnect from './disconnect'
export const dynamic='force-dynamic'
export default async function Page(){await staff();return <Disconnect/>}
