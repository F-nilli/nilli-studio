import { ClientKey, Track } from './types'

export interface TaskTemplate {
  id: number
  label: string
  assigneeName: string
  track: Track
  deps: number[]
  dueDays: number | null
  note?: string
}

export const CLIENT_TEMPLATES: Record<ClientKey, TaskTemplate[]> = {
  brandon_gentile: [
    { id: 1, label: 'Edit full podcast (cuts, trailer, ad reads, watermarks, outro)', assigneeName: 'Eph', track: 'Long-form', deps: [], dueDays: 3 },
    { id: 2, label: 'Internal revision', assigneeName: 'Ali', track: 'Review', deps: [1], dueDays: 4 },
    { id: 3, label: 'Client revision → re-edit & export', assigneeName: 'Eph', track: 'Long-form', deps: [2], dueDays: null },
  ],

  bitcoin_edge: [
    { id: 1, label: 'Select clip for trailer', assigneeName: 'Ali', track: 'Trailer', deps: [], dueDays: 1 },
    { id: 2, label: 'Edit trailer', assigneeName: 'Eph', track: 'Trailer', deps: [1], dueDays: 2 },
    { id: 3, label: 'Internal revision', assigneeName: 'Ali', track: 'Review', deps: [2], dueDays: 3 },
    { id: 4, label: 'Client revision → re-edit & export', assigneeName: 'Eph', track: 'Trailer', deps: [3], dueDays: null },
  ],

  peruvian_bull: [
    { id: 1, label: 'Edit video', assigneeName: 'Abdo', track: 'Long-form', deps: [], dueDays: 3 },
    { id: 2, label: 'Give thumbnail direction to Zeeshan', assigneeName: 'Francis', track: 'Thumbnails', deps: [], dueDays: 1 },
    { id: 3, label: 'Internal revision', assigneeName: 'Ali', track: 'Review', deps: [1], dueDays: 4 },
    { id: 4, label: 'Create 2x thumbnails', assigneeName: 'Zeeshan', track: 'Thumbnails', deps: [2], dueDays: 3 },
    { id: 5, label: 'Client revision → re-edit & export', assigneeName: 'Abdo', track: 'Long-form', deps: [3], dueDays: null },
  ],

  walker_america: [
    { id: 1, label: 'Select clip for trailer', assigneeName: 'Ali', track: 'Trailer', deps: [], dueDays: 1 },
    { id: 2, label: 'Review & approve clip selection', assigneeName: 'Francis', track: 'Trailer', deps: [1], dueDays: 1 },
    { id: 3, label: 'Edit trailer', assigneeName: 'Eph', track: 'Trailer', deps: [2], dueDays: 2 },
    { id: 4, label: 'Internal revision (trailer)', assigneeName: 'Ali', track: 'Review', deps: [3], dueDays: 3 },
    { id: 5, label: 'Give thumbnail direction to Zeeshan', assigneeName: 'Francis', track: 'Thumbnails', deps: [2], dueDays: 1, note: 'After reviewing clip selection' },
    { id: 6, label: 'Create 2x thumbnails', assigneeName: 'Zeeshan', track: 'Thumbnails', deps: [5], dueDays: 3 },
    { id: 7, label: 'Add trailer to long-form + ad reads + outro', assigneeName: 'Eph', track: 'Long-form', deps: [4], dueDays: 4 },
    { id: 8, label: 'Select long clip (8–12 min) + 2x shorts (60–90s)', assigneeName: 'Ali', track: 'Clips & Shorts', deps: [], dueDays: 2 },
    { id: 9, label: 'Edit clips and shorts', assigneeName: 'Nguyen', track: 'Clips & Shorts', deps: [8], dueDays: 3 },
    { id: 10, label: 'Internal revision (clips & shorts)', assigneeName: 'Ali', track: 'Review', deps: [9], dueDays: 4 },
    { id: 11, label: 'Schedule episode, clip, and shorts', assigneeName: 'Phil', track: 'Publishing', deps: [7, 10], dueDays: 5 },
    { id: 12, label: 'Client revision → re-edit & export', assigneeName: 'Eph', track: 'Long-form', deps: [4], dueDays: null, note: 'Triggered after client sends notes' },
  ],

  youre_the_voice: [
    { id: 1, label: 'Select clip for trailer', assigneeName: 'Ali', track: 'Trailer', deps: [], dueDays: 1 },
    { id: 2, label: 'Review & approve clip selection', assigneeName: 'Francis', track: 'Trailer', deps: [1], dueDays: 1 },
    { id: 3, label: 'Edit long-form (cuts, ad reads, graphics, outro)', assigneeName: 'Eph', track: 'Long-form', deps: [], dueDays: 3, note: 'Starts immediately, trailer added once ready' },
    { id: 4, label: 'Edit trailer', assigneeName: 'Eph', track: 'Trailer', deps: [2], dueDays: 2 },
    { id: 5, label: 'Add trailer to long-form', assigneeName: 'Eph', track: 'Long-form', deps: [4], dueDays: 3, note: 'Merge once trailer is ready' },
    { id: 6, label: 'Give thumbnail direction to Zeeshan', assigneeName: 'Francis', track: 'Thumbnails', deps: [2], dueDays: 1, note: 'After reviewing clip selection' },
    { id: 7, label: '2x thumbnails (1 template + 1 custom)', assigneeName: 'Zeeshan', track: 'Thumbnails', deps: [6], dueDays: 3 },
    { id: 8, label: 'Internal revision (long-form + trailer)', assigneeName: 'Ali', track: 'Review', deps: [5], dueDays: 4 },
    { id: 9, label: 'Cut short-forms from trailer clips', assigneeName: 'Eph', track: 'Clips & Shorts', deps: [4], dueDays: 3 },
    { id: 10, label: 'Create clips (captions, watermark, outro)', assigneeName: 'Eph', track: 'Clips & Shorts', deps: [9], dueDays: 4 },
    { id: 11, label: '1x thumbnail per clip', assigneeName: 'Zeeshan', track: 'Thumbnails', deps: [10], dueDays: 4 },
    { id: 12, label: 'Schedule full episode, clips, and shorts', assigneeName: 'Phil', track: 'Publishing', deps: [8, 10], dueDays: 5 },
    { id: 13, label: 'Client revision → re-edit & export', assigneeName: 'Eph', track: 'Long-form', deps: [8], dueDays: null, note: 'Triggered after client sends notes' },
  ],
}
