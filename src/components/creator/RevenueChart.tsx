'use client'

import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'

export type DayRevenue = { day: string; date: string; revenue: number }

function EmptyChart({ data }: { data: DayRevenue[] }) {
  return (
    <div>
      <div className="flex items-end gap-1.5 h-20 mb-1">
        {data.map(d => (
          <div key={d.date} className="flex-1 flex flex-col items-end gap-0.5">
            <div className="w-full bg-gray-100 rounded-t-sm" style={{ height: '100%' }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {data.map(d => (
          <div key={d.date} className="flex-1 text-center">
            <span className="text-[10px] text-gray-300">{d.day}</span>
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-gray-400 mt-4">
        Noch keine Einnahmen – deine Umsätze erscheinen hier sobald du verkaufst.
      </p>
    </div>
  )
}

export function RevenueChart({ data }: { data: DayRevenue[] }) {
  const hasRevenue = data.some(d => d.revenue > 0)

  if (!hasRevenue) return <EmptyChart data={data} />

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="30%">
        <XAxis
          dataKey="day"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: '#9ca3af' }}
        />
        <Tooltip
          cursor={{ fill: '#f9fafb' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <div className="bg-white border border-gray-100 shadow-lg rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-gray-900">
                  {formatCurrency(payload[0].value as number)}
                </p>
              </div>
            )
          }}
        />
        <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
          {data.map(entry => (
            <Cell
              key={entry.date}
              fill={entry.revenue > 0 ? '#22c55e' : '#f3f4f6'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
