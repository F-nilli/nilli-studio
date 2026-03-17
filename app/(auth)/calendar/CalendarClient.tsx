'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isSameDay,
  addMonths, subMonths, parseISO, isToday
} from 'date-fns'
import { Task, Episode, User } from '@/lib/types'
import { TaskModal } from '@/components/tasks/TaskModal'
import { cn, isOverdue } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'

interface Props {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
}

export function CalendarClient({ currentUser, tasks }: Props) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: calStart, end: calEnd })

  function getTasksForDay(day: Date) {
    return tasks.filter(t => t.due_date && isSameDay(parseISO(t.due_date), day))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Calendar</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-gray-900 dark:text-white min-w-[120px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-800">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
            <div key={day} className="px-2 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 text-center">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            const dayTasks = getTasksForDay(day)
            const isCurrentMonth = isSameMonth(day, currentMonth)
            const today = isToday(day)

            return (
              <div
                key={idx}
                className={cn(
                  'min-h-[100px] p-2 border-b border-r border-gray-100 dark:border-gray-800',
                  !isCurrentMonth && 'bg-gray-50/50 dark:bg-gray-800/20',
                  idx % 7 === 6 && 'border-r-0'
                )}
              >
                <div className={cn(
                  'text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full mb-1',
                  today ? 'bg-blue-600 text-white' : isCurrentMonth ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-600'
                )}>
                  {format(day, 'd')}
                </div>

                <div className="space-y-0.5">
                  {dayTasks.slice(0, 3).map(task => {
                    const overdue = isOverdue(task.due_date, task.status)
                    const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS]

                    return (
                      <button
                        key={task.id}
                        onClick={() => setSelectedTask(task)}
                        className={cn(
                          'w-full text-left text-xs px-1.5 py-0.5 rounded truncate font-medium transition-opacity hover:opacity-80',
                          overdue ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'text-white'
                        )}
                        style={!overdue ? { backgroundColor: trackColor + 'cc' } : {}}
                        title={`${task.label} — ${task.episode?.guest_name}`}
                      >
                        {task.episode?.guest_name}: {task.label}
                      </button>
                    )
                  })}
                  {dayTasks.length > 3 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 px-1">+{dayTasks.length - 3} more</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          currentUser={currentUser}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => setSelectedTask(updated)}
        />
      )}
    </div>
  )
}
