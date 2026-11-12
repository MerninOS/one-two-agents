import {
  Bell, Brain, Calculator, Calendar, Check, ChevronRight, CircleAlert, Clapperboard, ClipboardList, Clock, Compass, Cpu, Database, FileText,
  Flame, FlaskConical, GitPullRequest, Globe, History, Inbox, Landmark, LayoutDashboard, Leaf, List, Lock, LogOut, Mail, Menu, Moon, Pencil, Play,
  Plug, Receipt, Settings, ShieldAlert, ShieldCheck, ShoppingBag, SlidersHorizontal, Store, Sun, UserPlus, Users, X, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  bell: Bell, brain: Brain, calculator: Calculator, calendar: Calendar, check: Check, "chevron-right": ChevronRight, "circle-alert": CircleAlert,
  clapperboard: Clapperboard, "clipboard-list": ClipboardList, clock: Clock, compass: Compass, cpu: Cpu, database: Database,
  "file-text": FileText, flame: Flame, "flask-conical": FlaskConical, "git-pull-request": GitPullRequest, globe: Globe, history: History,
  inbox: Inbox, landmark: Landmark, "layout-dashboard": LayoutDashboard, leaf: Leaf, list: List, lock: Lock, "log-out": LogOut, mail: Mail, menu: Menu,
  moon: Moon, pencil: Pencil, play: Play, plug: Plug, receipt: Receipt, settings: Settings, "shield-alert": ShieldAlert, "shield-check": ShieldCheck,
  "shopping-bag": ShoppingBag, "sliders-horizontal": SlidersHorizontal, store: Store, sun: Sun, "user-plus": UserPlus, users: Users, x: X,
};

export function Icon({ name, size = 18, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const C = ICONS[name] ?? CircleAlert;
  return <C size={size} strokeWidth={1.75} className={className} style={style} aria-hidden />;
}
