import {sponsorshipAdmin} from '@/lib/portal/store'
import {redirect} from 'next/navigation'
export default async function Sponsorships(){await sponsorshipAdmin();redirect('/creator-portal/sponsorship-admin.html')}
