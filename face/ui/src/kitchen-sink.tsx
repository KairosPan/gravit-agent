import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const swatches = [
  ["background", "bg-background"],
  ["foreground", "bg-foreground"],
  ["primary", "bg-primary"],
  ["brand ink", "bg-brand-ink"],
  ["brand soft", "bg-brand-soft"],
  ["secondary", "bg-secondary"],
  ["muted", "bg-muted"],
  ["accent", "bg-accent"],
  ["destructive", "bg-destructive"],
  ["up", "bg-up"],
  ["down", "bg-down"],
  ["warn", "bg-warn"],
  ["info", "bg-info"],
  ["chart-1", "bg-chart-1"],
  ["chart-2", "bg-chart-2"],
  ["chart-3", "bg-chart-3"],
  ["chart-4", "bg-chart-4"],
  ["chart-5", "bg-chart-5"],
] as const;

const series = [
  { i: 0, v: 118 },
  { i: 1, v: 124 },
  { i: 2, v: 121 },
  { i: 3, v: 132 },
  { i: 4, v: 129 },
  { i: 5, v: 141 },
  { i: 6, v: 138 },
  { i: 7, v: 146 },
];

function applyTheme(next: "light" | "dark") {
  document.documentElement.classList.toggle("dark", next === "dark");
  document.documentElement.style.colorScheme = next;
}

export function KitchenSink() {
  const [theme, setTheme] = useState<"light" | "dark">(
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  function choose(next: "light" | "dark") {
    applyTheme(next);
    setTheme(next);
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-8 md:px-6 xl:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-caption text-muted-foreground">gravit. — tokens</p>
          <h1 className="text-title">Kitchen sink</h1>
          <p className="mt-2 max-w-xl text-body-lg text-muted-foreground">
            Light first. Cyan is a fill; text on it is the ink. Green is up and red is down.
          </p>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Theme">
          <Button
            type="button"
            size="sm"
            variant={theme === "light" ? "default" : "outline"}
            aria-pressed={theme === "light"}
            onClick={() => choose("light")}
          >
            <Sun />
            Light
          </Button>
          <Button
            type="button"
            size="sm"
            variant={theme === "dark" ? "default" : "outline"}
            aria-pressed={theme === "dark"}
            onClick={() => choose("dark")}
          >
            <Moon />
            Dark
          </Button>
        </div>
      </header>

      <p className="text-caption text-muted-foreground" data-num>
        <span className="md:hidden">Narrow, under 900</span>
        <span className="hidden md:inline xl:hidden">Tablet, 900 to 1279</span>
        <span className="hidden xl:inline">Desktop, 1280 and up</span>
      </p>

      <section className="flex flex-col gap-4">
        <h2 className="text-heading">Colour</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {swatches.map(([name, tone]) => (
            <div key={name} className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
              <div className={`h-12 ${tone}`} />
              <p className="text-caption px-2 py-1.5">{name}</p>
            </div>
          ))}
        </div>
        <p className="text-body" data-num>
          <span className="text-up-text">▲ +1.24%</span>
          <span className="px-3 text-muted-foreground">·</span>
          <span className="text-down-text">▼ −0.51%</span>
          <span className="px-3 text-muted-foreground">·</span>
          <span className="text-hero-number text-foreground">$128,430.52</span>
        </p>
        <p className="text-body" lang="zh">
          投资组合 · 自选股 · 需要你的确认
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-heading">Type</h2>
        <p className="text-display">Display</p>
        <p className="text-title">Title</p>
        <p className="text-heading">Heading</p>
        <p className="text-subheading">Subheading</p>
        <p className="text-body-lg">Body large. Messages and long reads sit here.</p>
        <p className="text-body">Body. Default UI text, tables and inputs.</p>
        <p className="text-caption text-muted-foreground">Caption. Timestamps, meta, badges.</p>
        <p>
          <code>order · mcp__account__portfolio_live_order</code>
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-heading">Radii and elevation</h2>
        <div className="flex flex-wrap items-end gap-4">
          {[
            ["sm 8", "rounded-sm"],
            ["md 12", "rounded-md"],
            ["lg 16", "rounded-lg"],
            ["xl 24", "rounded-xl"],
            ["full", "rounded-full"],
          ].map(([name, radius]) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <div className={`size-16 border border-border bg-secondary ${radius}`} />
              <span className="text-caption text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {["shadow-xs", "shadow-sm", "shadow-md", "shadow-lg"].map((shadow) => (
            <div key={shadow} className={`rounded-lg border border-border bg-card p-4 ${shadow}`}>
              <p className="text-caption">{shadow}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-heading">Components</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button">Approve order</Button>
          <Button type="button" variant="secondary">
            Secondary
          </Button>
          <Button type="button" variant="outline">
            Decline
          </Button>
          <Button type="button" variant="ghost">
            Ghost
          </Button>
          <Button type="button" variant="destructive">
            Destructive
          </Button>
          <Button type="button" variant="link">
            Brand ink link
          </Button>
          <Button type="button" disabled>
            Disabled
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>Paper</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="up">▲ +1.24%</Badge>
          <Badge variant="down">▼ −0.51%</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Needs your approval</CardTitle>
            <CardDescription>A card uses the border and the resting shadow.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="symbol">Symbol</Label>
                <Input id="symbol" defaultValue="NVDA" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="limit">Limit</Label>
                <Input id="limit" inputMode="decimal" defaultValue="179.50" data-num />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="note">Note</Label>
              <Textarea id="note" defaultValue="NVDA beat on data-center revenue." />
            </div>
            <Separator />
            <Tabs defaultValue="order">
              <TabsList>
                <TabsTrigger value="order">Order</TabsTrigger>
                <TabsTrigger value="rationale">Rationale</TabsTrigger>
              </TabsList>
              <TabsContent value="order" className="text-body pt-3" data-num>
                10 shares · limit $179.50 · est. cost $1,795.00
              </TabsContent>
              <TabsContent value="rationale" className="text-body pt-3">
                Price is 1.6% under the 20-day average.
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-heading">Chart</h2>
        <p className="text-caption text-muted-foreground">
          Series order is chart-1 through chart-5. A price line uses up or down, not that palette.
        </p>
        <div className="h-40 rounded-lg border border-border bg-card p-3 shadow-xs">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <YAxis hide domain={["dataMin - 8", "dataMax + 8"]} />
              <Area
                dataKey="v"
                stroke="var(--up)"
                fill="var(--up)"
                fillOpacity={0.16}
                strokeWidth={2}
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
}
