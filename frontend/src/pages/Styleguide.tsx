import { useState } from "react";
import { BellRing, Wallet } from "lucide-react";
import {
  AmountInput, AppIcon, Badge, BarList, Button, Card, CardHeader, Chips, Disclosure, EmptyState, Flag, Input, KeyValue, ListRow, Meter, Note, PageHeader,
  Ring, RowIcon, Select, Skeleton, Stat, StatusDot, Tabs, TierTag, Timeline, Toggle, Wordmark,
} from "../ui";

const COLORS = ["bg", "surface", "surface-muted", "line", "ink", "ink-muted", "primary", "primary-hover", "primary-soft", "accent", "accent-text", "success", "warning", "danger"];
const SWATCH: Record<string, string> = {
  bg: "bg-bg", surface: "bg-surface", "surface-muted": "bg-surface-muted", line: "bg-line", ink: "bg-ink", "ink-muted": "bg-ink-muted", primary: "bg-primary", "primary-hover": "bg-primary-hover",
  "primary-soft": "bg-primary-soft", accent: "bg-accent", "accent-text": "bg-accent-text", success: "bg-success", warning: "bg-warning", danger: "bg-danger",
};
const TYPE = [
  ["text-display", "Money across borders"], ["text-h1", "Page title"], ["text-amount-xl", "£16,059"], ["text-h2", "Card title"],
  ["text-body", "Body text for reading."], ["text-body-strong", "Row title or button"], ["text-small", "Secondary line and helper text"], ["text-caption", "Badge, label, chart axis"],
];

/** Hidden route (#/styleguide): every token and component on one page, to check consistency. */
export default function Styleguide() {
  const [tab, setTab] = useState<"a" | "b">("a");
  const [chip, setChip] = useState("all");
  const [on, setOn] = useState(true);
  const [amt, setAmt] = useState("9250");
  return (
    <div className="space-y-12">
      <PageHeader title="Styleguide" description="Every token, text style and component in one place." />
      <Card><CardHeader title="Brand" /><div className="flex flex-wrap items-center gap-8"><Wordmark height={48} /><Wordmark height={20} /><div className="rounded-card bg-primary p-4"><Wordmark height={32} tone="reversed" /></div><Wordmark height={32} tone="mono" /><AppIcon size={64} /><AppIcon size={32} /><AppIcon size={16} /></div></Card>
      <Card><CardHeader title="Colour" /><div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">{COLORS.map((c) => <div key={c}><div className={`h-16 rounded-input border border-line ${SWATCH[c]}`} /><div className="mt-2 text-caption">{c}</div></div>)}</div></Card>
      <Card><CardHeader title="Type scale" description="Nothing outside these eight styles." /><div className="space-y-4">{TYPE.map(([cls, sample]) => <div key={cls} className="flex flex-col gap-1 border-b border-line pb-4 sm:flex-row sm:items-baseline sm:gap-6"><code className="w-40 shrink-0 text-caption text-ink-muted">{cls}</code><span className={cls}>{sample}</span></div>)}</div></Card>
      <Card>
        <CardHeader title="Buttons and badges" />
        <div className="flex flex-wrap gap-3"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button size="sm">Small</Button><Button loading>Loading</Button><Button disabled>Disabled</Button></div>
        <div className="mt-6 flex flex-wrap gap-2"><Badge>Neutral</Badge><Badge tone="primary">Primary</Badge><Badge tone="accent">Recommended</Badge><Badge tone="success">Arrived</Badge><Badge tone="warning">Needs your approval</Badge><Badge tone="danger">Blocked</Badge><TierTag tier="T2" /><StatusDot tone="success">Arrived</StatusDot></div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <CardHeader title="Inputs" />
          <AmountInput label="They receive" value={amt} onChange={setAmt} currency="GBP" />
          <Input placeholder="Search" />
          <Select defaultValue="1"><option value="1">Northbridge University (demo)</option></Select>
          <div className="flex items-center gap-4"><Toggle checked={on} onChange={setOn} label="Example toggle" /><Tabs value={tab} onChange={setTab} items={[{ value: "a", label: "Send money" }, { value: "b", label: "Recipients" }]} /></div>
          <Chips value={chip} onChange={setChip} items={[{ value: "all", label: "All" }, { value: "money", label: "Payments" }]} />
        </Card>
        <Card className="space-y-6">
          <CardHeader title="Data" />
          <Stat label="Total balance" value="£16,059" sub="Available to spend: £6,659" />
          <Meter value={62} />
          <div className="flex items-center gap-6"><Ring value={42} size={96} /><Timeline steps={[{ key: "a", label: "Sent" }, { key: "b", label: "On its way" }, { key: "c", label: "Arrived" }]} current={1} /></div>
          <BarList rows={[{ label: "Rent", value: 650 }, { label: "Groceries", value: 229, badge: <Badge tone="accent">+48% vs last month</Badge> }, { label: "Transport", value: 84 }]} highlight="Groceries" format={(v) => `£${v}`} />
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rows" />
          <ListRow leading={<RowIcon><Wallet className="h-5 w-5" /></RowIcon>} title="Corner Grocer" subtitle="15 Oct, 19:38 · Groceries" trailing="−£27.29" />
          <ListRow leading={<Flag currency="BDT" size={44} />} title="Bangladeshi taka" subtitle="Wallet" trailing="৳2,400,000" chevron onClick={() => undefined} />
          <KeyValue label="Arrives by" value="Thu 22 Oct" />
          <Disclosure summary="Fee breakdown"><KeyValue label="Fee" value="৳1,837.50" /></Disclosure>
        </Card>
        <Card className="space-y-4">
          <CardHeader title="States" />
          <Note tone="warning" icon={<BellRing className="h-4 w-4" />}>This one needs an extra check.</Note>
          <Note tone="danger">That code is wrong.</Note>
          <Note tone="mint">Budget set. You can undo this.</Note>
          <EmptyState title="No transactions yet." />
          <Skeleton className="h-6" />
        </Card>
      </div>
    </div>
  );
}
