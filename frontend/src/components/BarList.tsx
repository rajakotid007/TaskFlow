import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

/**
 * Single-series horizontal bar chart: one hue (identity is the row label, so
 * no legend), direct value labels, recessive grid, per-bar tooltip.
 */
export function BarList({ data, label }: { data: { name: string; value: number }[]; label: string }) {
  if (data.every((d) => d.value === 0)) {
    return <p className="py-8 text-center text-sm text-slate-500">Nothing to show yet.</p>
  }
  const height = Math.max(120, data.length * 34 + 16)
  return (
    <figure aria-label={label}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 4 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
            <XAxis type="number" allowDecimals={false} hide />
            <YAxis
              type="category"
              dataKey="name"
              width={132}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: 'currentColor' }}
              className="text-slate-600 dark:text-slate-400"
            />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.12)' }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              formatter={(v) => [v, label]}
            />
            <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
              <LabelList dataKey="value" position="right" className="fill-slate-700 text-xs dark:fill-slate-300" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Table view for screen readers. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.name}>
              <th scope="row">{d.name}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
