"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, Check, CheckCheck, ChevronDown, ChevronRight, Cloud, CreditCard, Download, Home, LoaderCircle, Plus, ReceiptText, RefreshCw, Scissors, Search, Settings, ShieldCheck, Smartphone, UserPlus, Users, Wallet, WifiOff, X, CircleHelp, RotateCcw, CalendarDays, LogOut, UserRound } from "lucide-react";
import type { LedgerTransaction as Transaction, Member, SalonBootstrap as Data } from "@/lib/salon-types";

import OfflinePanel from "./offline-panel";
import { isOfflineApp, offlineApi, offlineStatus, nativeCall } from "@/lib/salon-offline-client";
import { csvCell } from "@/lib/salon-csv";

type Tab = "home" | "members" | "ledger" | "settings";
type Kind = "member" | "card" | "recharge" | "consume" | "reversal" | "shop" | "service" | "detail" | "deleteMember" | "restoreMember";
type Modal = { kind: Kind; id?: string; key: string };
type Form = Record<string, string>;
type Submission = { path: string; method: string; body: Record<string, unknown> };
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const nav = [{ id: "home" as Tab, label: "工作台", icon: Home }, { id: "members" as Tab, label: "会员", icon: Users }, { id: "ledger" as Tab, label: "流水", icon: ReceiptText }, { id: "settings" as Tab, label: "设置", icon: Settings }];
const money = (amount = 0) => (amount / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const yuan = (amount = 0) => `¥${money(amount)}`;
const dateKey = (value: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const dateTime = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
const cardNo = (id: string) => `尾号 ${id.replace(/-/g, "").slice(-8).toUpperCase()}`;
const initial = (name: string) => name.trim().slice(0, 1) || "客";
function cents(value: string, label: string, allowZero = false): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error(`${label}请填写有效金额，最多两位小数`);
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount > 100000000 || (!allowZero && amount <= 0)) throw new Error(`${label}${allowZero ? "不能小于 0" : "须大于 0"}，单笔最多 100 万元`);
  return amount;
}
class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}
async function api(path: string, options?: RequestInit) {
  if (isOfflineApp()) return offlineApi(path, options);
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  let result: Record<string, unknown>;
  try { result = await response.json(); } catch { throw new Error(response.status === 401 ? "登录已过期，请重新登录" : "云端暂时无法连接，请稍后重试"); }
  if (!response.ok) throw new ApiError(typeof result.error === "string" ? result.error : "操作未完成，请重试", response.status, String(result.code || ""));
  return result;
}
function DialogHeader({ children, close, busy }: { children: ReactNode; close: () => void; busy: boolean }) {
  return <div className="dialog-header"><div><span className="dialog-brand">千丝万缕</span><h2 id="dialog-title">{children}</h2></div><button type="button" className="icon-button" aria-label="关闭弹窗" onClick={close} disabled={busy}><X size={22} /></button></div>;
}
function EmptyState({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return <div className="full-empty"><div className="empty-illustration">{icon}</div><h2>{title}</h2><p>{text}</p>{children}</div>;
}

export default function SalonApp({ user }: { user: { displayName: string; email: string } }) {
  const localEnabled = isOfflineApp();
  const [tab, setTab] = useState<Tab>("home");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [online, setOnline] = useState(true);
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [cardFilter, setCardFilter] = useState("all");
  const [ledgerFilter, setLedgerFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [form, setForm] = useState<Form>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [toast, setToast] = useState("");
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [nativeInstalled, setNativeInstalled] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ledgerRows, setLedgerRows] = useState<Transaction[]>([]);
  const [ledgerCursor, setLedgerCursor] = useState<string | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState("");
  const pendingSubmission = useRef<Submission | null>(null);
  const ledgerSequence = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const [loggingOut,setLoggingOut] = useState(false);
  async function logout() {setLoggingOut(true);try {await api("/api/auth/logout",{method:"POST",body:"{}"});window.location.assign("/login");}catch(error){setToast(error instanceof Error?error.message:"退出失败，请重试");}finally{setLoggingOut(false);}}
  const loadSequence = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const reload = useCallback(async (quiet = false) => {
    const sequence = ++loadSequence.current;
    if (!quiet) setLoading(true);
    try {
      const result = await api("/api/bootstrap");
      if (mounted.current && sequence === loadSequence.current) { setData(result as unknown as Data); setLoadError(""); }
      return result as unknown as Data;
    } catch (error) {
      if (mounted.current && sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : "数据加载失败");
      return null;
    } finally { if (mounted.current && sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const updateOnline = () => { setOnline(navigator.onLine); if ((isOfflineApp() || navigator.onLine) && !pendingSubmission.current) void reload(true); };
    const refreshOnFocus = () => { if ((isOfflineApp() || navigator.onLine) && !pendingSubmission.current) void reload(true); };
    const installation = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    const installFinished = () => { setInstalled(true); setInstallPrompt(null); };
    const isNative = new URLSearchParams(window.location.search).get("source") === "android";
    setNativeInstalled(isNative);
    setOnline(navigator.onLine); setInstalled(isNative || window.matchMedia("(display-mode: standalone)").matches);
    void reload();
    if (!isOfflineApp() && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    window.addEventListener("salon-local-change", refreshOnFocus);
    window.addEventListener("online", updateOnline); window.addEventListener("offline", updateOnline); window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("beforeinstallprompt", installation); window.addEventListener("appinstalled", installFinished);
    return () => { window.removeEventListener("salon-local-change", refreshOnFocus); mounted.current = false; window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline); window.removeEventListener("focus", refreshOnFocus); window.removeEventListener("beforeinstallprompt", installation); window.removeEventListener("appinstalled", installFinished); };
  }, [reload]);
  const loadLedger = useCallback(async (cursor: string | null = null) => {
    const sequence = ++ledgerSequence.current;
    setLedgerLoading(true); setLedgerError("");
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (fromDate) params.set("from", fromDate); if (toDate) params.set("to", toDate); if (ledgerFilter !== "all") params.set("type", ledgerFilter); if (cursor) params.set("cursor", cursor);
      const result = await api(`/api/transactions?${params}`);
      if (mounted.current && sequence === ledgerSequence.current) { setLedgerRows(current => cursor ? [...current, ...result.transactions as Transaction[]] : result.transactions as Transaction[]); setLedgerCursor(result.nextCursor as string | null); }
    } catch (error) { if (mounted.current && sequence === ledgerSequence.current) setLedgerError(error instanceof Error ? error.message : "流水加载失败"); }
    finally { if (mounted.current && sequence === ledgerSequence.current) setLedgerLoading(false); }
  }, [fromDate, toDate, ledgerFilter]);
  useEffect(() => {
    if (tab === "ledger" && data && online) { setLedgerRows([]); setLedgerCursor(null); void loadLedger(); }
    return () => { ledgerSequence.current++; };
  }, [tab, data, online, loadLedger]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 5000); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (modal) { if (!dialogRef.current?.open) dialogRef.current?.showModal(); const timer = window.setTimeout(() => firstInputRef.current?.focus(), 100); return () => window.clearTimeout(timer); }
    dialogRef.current?.close();
  }, [modal]);
  const writesEnabled = (localEnabled || online) && !!data && !loadError && (!localEnabled || !offlineStatus().busy);
  const today = dateKey(data?.serverTime || new Date());
  const allMembers = data?.members || [];
  const members = allMembers.filter(member => !member.deletedAt);
  const cards = data?.cards || [];
  const transactions = data?.transactions || [];
  const services = (data?.services || []).filter(service => service.active);
  const memberMap = useMemo(() => new Map(data?.members.map(member => [member.id, member]) || []), [data]);
  const cardMap = useMemo(() => new Map(data?.cards.map(card => [card.id, card]) || []), [data]);
  const reversed = useMemo(() => new Set([...data?.transactions || [], ...ledgerRows].filter(transaction => transaction.type === "reversal").map(transaction => transaction.reversedTransactionId)), [data, ledgerRows]);
  const locked = busy || uncertain;
  const setValue = (name: string, value: string) => { if (locked) return; setForm(current => ({ ...current, [name]: value })); setFormError(""); setReviewing(false); };
  const open = (kind: Kind, id?: string, prefill: Form = {}) => {
    if (kind !== "detail" && !writesEnabled) { setToast(localEnabled ? "请等待当前同步或加载完成" : online ? "请先恢复云端连接" : "当前已离线，联网后可继续记账"); return; }
    const memberId = id && ["card", "consume", "recharge"].includes(kind) ? id : "";
    const selected = cards.find(card => card.memberId === memberId);
    const base: Form = { identifierType:"name", name: "", phone: "", note: "", memberId, cardId: selected?.id || "", cardName: "储值会员卡", paid: "", gift: "0", amount: services[0] ? (services[0].priceCents / 100).toFixed(2) : "", serviceId: services[0]?.id || "", continueCard: "yes", shopName: data?.settings.shopName || "", shopPhone: data?.settings.phone || "", address: data?.settings.address || "", lowBalance: String((data?.settings.lowBalanceCents ?? 10000) / 100), price: "", active: "true", ...prefill };
    if (kind === "service" && id) { const service = data?.services.find(item => item.id === id); if (service) Object.assign(base, { name: service.name, price: (service.priceCents / 100).toFixed(2), active: String(service.active) }); }
    pendingSubmission.current = null; setUncertain(false); setForm(base); setModal({ kind, id, key: crypto.randomUUID() }); setFormError(""); setReviewing(false);
  };
  const close = () => { if (!busy) { if (uncertain) { setTab("ledger"); setToast("请先核对最新流水，确认上次操作结果后再记新账"); void reload(true); } pendingSubmission.current = null; setUncertain(false); setModal(null); setFormError(""); setReviewing(false); } };
  const selectedCard = cardMap.get(form.cardId);
  const selectedMember = memberMap.get(form.memberId || selectedCard?.memberId || "");
  const selectedTransaction = transactions.find(transaction => transaction.id === modal?.id) || ledgerRows.find(transaction => transaction.id === modal?.id);
  const detailMember = modal?.kind === "detail" ? memberMap.get(modal.id || "") : null;
  const detailCards = cards.filter(card => card.memberId === detailMember?.id);
  const actionMember = memberMap.get(modal?.id || "");
  function requestForForm(): Submission {
    if (!modal) throw new Error("请选择操作");
    if (modal.kind === "deleteMember" || modal.kind === "restoreMember") {
      if (!actionMember) throw new Error("找不到这位会员");
      if (modal.kind === "deleteMember" && cards.some(card => card.memberId === actionMember.id && card.balanceCents > 0)) throw new Error("会员卡还有余额，请先核对并结清余额再删除");
      return {path:`/api/members/${encodeURIComponent(actionMember.id)}${modal.kind === "restoreMember" ? "/restore" : ""}`,method:modal.kind === "restoreMember" ? "POST" : "DELETE",body:{}};
    }
    if (modal.kind === "member") {
      if (form.identifierType === "name" && !form.name.trim()) throw new Error("请填写会员姓名");
      if (form.identifierType === "phone" && !/^\+?[\d\s-]{7,20}$/.test(form.phone.trim())) throw new Error("请填写有效手机号或联系电话");
      return { path: "/api/members", method: "POST", body: { name: form.identifierType === "name" ? form.name.trim() : "", phone: form.identifierType === "phone" ? form.phone.trim().replace(/[\s-]/g, "") : "", note: form.note.trim() } };
    }
    if (modal.kind === "card") {
      if (!selectedMember) throw new Error("请选择会员");
      if (cards.some(card => card.memberId === selectedMember.id)) throw new Error("这位会员已有会员卡，请直接充值或划卡");
      if (!form.cardName.trim()) throw new Error("请填写会员卡名称");
      return { path: "/api/cards", method: "POST", body: { memberId: selectedMember.id, name: form.cardName.trim(), type: "stored", paidCents: cents(form.paid, "实收金额"), giftCents: cents(form.gift || "0", "赠送金额", true), idempotencyKey: modal.key } };
    }
    if (modal.kind === "consume" || modal.kind === "recharge") {
      if (!selectedCard) throw new Error("请选择要操作的会员卡");
      const body: Record<string, unknown> = { type: modal.kind, cardId: selectedCard.id, expectedVersion: selectedCard.version, idempotencyKey: modal.key, note: form.note.trim() };
      if (modal.kind === "recharge") { body.paidCents = cents(form.paid, "实收金额"); body.giftCents = cents(form.gift || "0", "赠送金额", true); }
      else {
        if (!services.some(service => service.id === form.serviceId)) throw new Error("请先在设置里添加服务项目，再选择本次服务");
        body.serviceId = form.serviceId; body.amountCents = cents(form.amount, "消费金额");
        if (Number(body.amountCents) > selectedCard.balanceCents) throw new Error("卡内余额不足，请先充值或调整消费金额");
      }
      return { path: "/api/transactions", method: "POST", body };
    }
    if (modal.kind === "reversal") {
      if (!selectedTransaction || selectedTransaction.type === "reversal" || reversed.has(selectedTransaction.id)) throw new Error("该笔流水无法撤销");
      if (form.note.trim().length < 2) throw new Error("请填写撤销原因，至少 2 个字");
      return { path: "/api/transactions", method: "POST", body: { type: "reversal", transactionId: selectedTransaction.id, note: form.note.trim(), idempotencyKey: modal.key } };
    }
    if (modal.kind === "shop") {
      if (!form.shopName.trim()) throw new Error("请填写店铺名称");
      return { path: "/api/settings", method: "PATCH", body: { shopName: form.shopName.trim(), phone: form.shopPhone.trim(), address: form.address.trim(), lowBalanceCents: cents(form.lowBalance, "低余额提醒", true) } };
    }
    if (modal.kind === "service") {
      if (!form.name.trim()) throw new Error("请填写服务名称");
      return { path: "/api/services", method: modal.id ? "PATCH" : "POST", body: { ...(modal.id ? { id: modal.id } : {}), name: form.name.trim(), priceCents: cents(form.price, "服务价格"), active: form.active === "true" } };
    }
    throw new Error("请选择操作");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !writesEnabled) return;
    try {
      const request = pendingSubmission.current || requestForForm();
      if (["card", "recharge", "consume", "reversal"].includes(modal?.kind || "") && !reviewing) { setReviewing(true); return; }
      submitting.current = true; setBusy(true); setFormError(""); pendingSubmission.current = request;
      const body = ["deleteMember", "restoreMember"].includes(modal?.kind || "") ? undefined : JSON.stringify(request.body);
      const result = await api(request.path, { method: request.method, body, headers: { "X-Local-Operation-Id": modal?.key || "" } });
      const continueCard = modal?.kind === "member" && form.continueCard === "yes";
      const createdMember = result.member as Member | undefined;
      const kind = modal?.kind;
      pendingSubmission.current = null; setUncertain(false); setModal(null); setReviewing(false);
      const fresh = await reload(true);
      const labels: Partial<Record<Kind, string>> = { deleteMember:"会员已删除，可在已删除列表恢复", restoreMember:"会员已恢复", member: "会员已保存到云端", card: "办卡成功，已记入云端流水", recharge: "充值成功，已记入云端流水", consume: "消费已记账", reversal: "已撤销，冲正记录已保留", shop: "店铺资料已保存", service: "服务项目已保存" };
      setToast(fresh ? localEnabled ? "已保存到本地，可稍后手动同步" : labels[kind || "detail"] || "保存成功" : localEnabled ? "已保存到本地，刷新失败，请重试核对" : "已保存到云端，刷新失败，请点击重试核对最新记录");
      if (continueCard && createdMember && fresh) { setForm(current => ({ ...current, memberId: createdMember.id, cardName: "储值会员卡", paid: "", gift: "0" })); setModal({ kind: "card", key: crypto.randomUUID() }); }
    } catch (error) {
      const financial = ["card", "recharge", "consume", "reversal"].includes(modal?.kind || "");
      const ambiguous = financial && pendingSubmission.current && (!(error instanceof ApiError) || error.status >= 500);
      if (ambiguous) { setUncertain(true); setReviewing(true); setFormError("上次提交的结果尚未确认。请点击“重试同一笔操作”，系统会核对同一流水，避免重复记账。也可以关闭后先查看最新流水。"); }
      else { pendingSubmission.current = null; setUncertain(false); setFormError(error instanceof Error ? error.message : "操作未完成"); setReviewing(false); setModal(current => current ? { ...current, key: crypto.randomUUID() } : null); if (error instanceof ApiError) void reload(true); }
    }
    finally { submitting.current = false; setBusy(false); }
  }
  async function exportLedger() {
    if (exporting || (!localEnabled && !online)) return;
    setExporting(true);
    try {
      const all: Transaction[] = []; let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ limit: "500" }); if (fromDate) params.set("from", fromDate); if (toDate) params.set("to", toDate); if (ledgerFilter !== "all") params.set("type", ledgerFilter); if (cursor) params.set("cursor", cursor);
        const page = await api(`/api/transactions?${params}`); all.push(...page.transactions as Transaction[]); cursor = page.nextCursor as string | null;
      } while (cursor);
      const rows = [["时间", "会员", "联系电话", "会员卡", "类型", "金额（元）", "实收（元）", "赠送（元）", "服务金额（元）", "操作后余额（元）", "备注", "流水编号"], ...all.filter(item => ledgerFilter === "all" || item.type === ledgerFilter).map(item => [item.createdAt, memberMap.get(item.memberId)?.name || "", memberMap.get(item.memberId)?.phone || "", cardMap.get(item.cardId)?.name || "", item.type === "consume" ? "划卡消费" : item.type === "recharge" ? "充值/办卡" : "撤销", (item.amountCents / 100).toFixed(2), (item.cashReceivedCents / 100).toFixed(2), (item.giftCents / 100).toFixed(2), (item.serviceSpendCents / 100).toFixed(2), (item.balanceAfterCents / 100).toFixed(2), item.note, item.id])];
      const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
      if (localEnabled) { const result=await nativeCall<{cancelled?:boolean}>("exportCsv",{name:`千丝万缕-流水-${fromDate || "全部"}-${toDate || today}.csv`,csv}); setToast(result.cancelled ? "已取消导出" : "流水已导出，请妥善保管文件"); return; }
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `千丝万缕-流水-${fromDate || "全部"}-${toDate || today}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setToast("流水已导出，请妥善保管下载文件");
    } catch (error) { setToast(error instanceof Error ? error.message : "导出失败"); }
    finally { setExporting(false); }
  }
  const filteredMembers = allMembers.filter(member => !!member.deletedAt === showDeleted).filter(member => {
    const own = cards.filter(card => card.memberId === member.id); const q = search.toLowerCase().trim();
    const matches = !q || `${member.name} ${member.phone} ${own.map(card => `${card.id} ${card.name}`).join(" ")}`.toLowerCase().includes(q);
    return matches && (cardFilter === "all" || (cardFilter === "none" ? !own.length : own.some(card => card.balanceCents <= (data?.settings.lowBalanceCents || 0))));
  });
  const filteredTransactions = ledgerRows;
  const lowCards = cards.filter(card => !memberMap.get(card.memberId)?.deletedAt && card.balanceCents <= (data?.settings.lowBalanceCents || 0));
  const title = nav.find(item => item.id === tab)?.label || "工作台";
  const calendarLabel = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date(data?.serverTime || Date.now()));
  const week = (data?.summary.weekReceipts || []).map(day => ({ key: day.date, label: day.date.slice(5).replace("-", "/"), value: day.cashReceivedCents }));
  const weekMax = Math.max(1, ...week.map(day => Math.max(day.value, 0)));
  const field = (label: string, name: string, options: { placeholder?: string; type?: string; hint?: string; required?: boolean; maxLength?: number } = {}) => <label className="field" key={name}><span>{label}{options.required && <b aria-label="必填"> *</b>}</span><input ref={name === "name" || name === "shopName" ? firstInputRef : undefined} name={name} type={options.type || "text"} step={options.type === "number" ? "0.01" : undefined} inputMode={options.type === "number" ? "decimal" : options.type === "tel" ? "tel" : undefined} value={form[name] || ""} onChange={event => setValue(name, event.target.value)} placeholder={options.placeholder} maxLength={options.maxLength} required={options.required} disabled={locked} autoComplete="off" />{options.hint && <small>{options.hint}</small>}</label>;
  const notes = (label = "备注", required = false) => <label className="field"><span>{label}{required && <b> *</b>}</span><textarea value={form.note || ""} onChange={event => setValue("note", event.target.value)} placeholder={required ? "例如：金额录入有误，重新记账" : "选填，例如发型偏好、经手人"} maxLength={500} rows={3} required={required} disabled={locked} /></label>;
  const memberSelect = () => <label className="field"><span>选择会员 <b>*</b></span><select value={form.memberId} onChange={event => { const memberId = event.target.value; const card = cards.find(item => item.memberId === memberId); setForm(current => ({ ...current, memberId, cardId: card?.id || "" })); setReviewing(false); setFormError(""); }} required disabled={locked}><option value="">请选择会员</option>{members.filter(member => modal?.kind !== "card" || !cards.some(card => card.memberId === member.id)).map(member => <option key={member.id} value={member.id}>{member.name}{member.phone && member.phone !== member.name ? ` · ${member.phone}` : ""}</option>)}</select></label>;
  const cardSelect = () => <>{memberSelect()}<label className="field"><span>选择会员卡 <b>*</b></span><select value={form.cardId} onChange={event => setValue("cardId", event.target.value)} required disabled={locked}><option value="">请选择会员卡</option>{cards.filter(card => card.memberId === form.memberId).map(card => <option key={card.id} value={card.id}>{card.name} · {cardNo(card.id)} · {yuan(card.balanceCents)}</option>)}</select></label>{form.memberId && !cards.some(card => card.memberId === form.memberId) && <div className="inline-info">这位会员还没有会员卡。<button type="button" className="text-button" onClick={() => open("card", form.memberId)}>立即办卡</button></div>}</>;
  const transactionRow = (transaction: Transaction, compact = false) => {
    const member = memberMap.get(transaction.memberId); const card = cardMap.get(transaction.cardId); const isReversed = reversed.has(transaction.id);
    return <div className={`ledger-row ${compact ? "compact" : ""}`} key={transaction.id}><span className={`transaction-icon ${transaction.type}`} aria-hidden="true">{transaction.type === "consume" ? <Scissors size={18} /> : transaction.type === "recharge" ? <ArrowDownLeft size={19} /> : <RotateCcw size={17} />}</span><div className="ledger-person"><strong>{member?.name || "会员"}<span className={`tag ${transaction.type}`}>{transaction.type === "consume" ? "划卡" : transaction.type === "recharge" ? "充值" : "撤销"}</span>{isReversed && <span className="tag neutral">已撤销</span>}</strong><span>{transaction.serviceName || card?.name || "会员卡"}{!compact && transaction.note ? ` · ${transaction.note}` : ""}</span></div><span className="ledger-time">{dateTime(transaction.createdAt)}</span><div className={`ledger-amount ${transaction.type}`}><strong>{transaction.amountCents < 0 ? "−" : transaction.type === "consume" ? "−" : "+"}{yuan(Math.abs(transaction.amountCents))}</strong><small>{transaction.type === "consume" ? "卡内消费" : transaction.type === "recharge" ? `实收 ${yuan(transaction.cashReceivedCents)}` : "冲正记录"}</small></div>{!compact && <button className="text-button reversal-button" disabled={!writesEnabled || isReversed || transaction.type === "reversal"} onClick={() => open("reversal", transaction.id)} aria-label={`撤销${member?.name || "会员"}的${dateTime(transaction.createdAt)}流水`}>{transaction.type !== "reversal" ? "撤销" : "—"}</button>}</div>;
  };

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/" aria-label="千丝万缕首页"><span className="brand-symbol"><Scissors size={31} strokeWidth={2.5} /></span><span><b>千丝万缕</b></span></a><div className="sidebar-store"><span className="store-avatar"><Scissors size={20} strokeWidth={2.5} /></span><div><strong>{data?.settings.shopName || "千丝万缕理发店"}</strong><span>店主工作空间</span></div><ChevronDown size={15} /></div><div className="nav-caption">店铺管理</div><nav aria-label="管理页面">{nav.map(item => <button className={`nav-item ${tab === item.id ? "active" : ""}`} key={item.id} onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined}><item.icon size={20} strokeWidth={1.8} /><span>{item.label}</span>{item.id === "members" && <small>{data?.summary.memberCount ?? 0}</small>}{tab === item.id && <span className="nav-active-dot" />}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><ShieldCheck size={23} /><strong>{localEnabled ? "本地先保存，手动同步" : "账目在云端，开店更安心"}</strong><p>{localEnabled ? "断网也能打开和记账" : "会员与账目按账号独立保存"}<br />每笔操作都有记录</p></div><button className="help-link" onClick={() => setTab("settings")}><CircleHelp size={17} />安装与账号<ChevronRight size={15} /></button><div className="sidebar-user"><span className="user-avatar"><UserRound size={19} strokeWidth={2.5} /></span><div><strong>店主账号</strong><span title={user.email}>{user.email}</span></div></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="mobile-brand"><span><Scissors size={25} strokeWidth={2.5} /></span><b>千丝万缕</b></div><div className="breadcrumb">店铺管理<ChevronRight size={13} /><strong>{title}</strong></div><div className="topbar-right"><span className={`cloud-pill ${!online || loadError ? "warning" : ""}`}>{!online ? <WifiOff size={14} /> : <Cloud size={14} />}{localEnabled ? offlineStatus().connected ? "已连接至云端" : "未连接至云端" : !online ? "当前离线" : loadError ? "连接异常" : loading ? "云端连接中" : "云端已同步"}</span><button className="icon-button notification-button" onClick={() => { setTab("members"); setCardFilter("low"); }} aria-label={`查看余额提醒，${lowCards.length}张卡`}><Bell size={19} />{lowCards.length > 0 && <i />}</button><span className="user-avatar top-avatar"><UserRound size={19} strokeWidth={2.5} /></span></div></header>
      <main className="content">
        {!localEnabled && (!online || loadError) && <div className="connection-alert" role="alert"><WifiOff size={19} /><div><strong>{!online ? "网络已断开，记账已暂停" : "暂时无法获取最新云端数据"}</strong><span>{!online ? "重新联网后刷新数据，再进行充值或划卡。" : loadError}</span></div>{online && <button className="button small secondary" onClick={() => void reload()} disabled={loading}><RefreshCw size={15} className={loading ? "spinning" : ""} />重试</button>}</div>}
        {localEnabled && <OfflinePanel/>}<div className="page-heading"><div><p className="page-date">{tab === "home" ? calendarLabel : tab === "members" ? "保存熟客资料，随时核对余额" : tab === "ledger" ? "充值、划卡与撤销都有记录" : "店铺资料、服务项目与手机安装"}</p><h1>{tab === "home" ? "今日营业账" : tab === "members" ? "会员管理" : tab === "ledger" ? "经营流水" : "店铺设置"}</h1>{tab === "home" && <p>{data?.settings.shopName || "千丝万缕理发店"}，今天的生意从这里开始。</p>}</div><div className="heading-actions">{tab === "home" && <button className="button secondary desktop-only" onClick={() => { setTab("ledger"); setFromDate(today); setToDate(today); }}><CalendarDays size={17} />今日流水</button>}{(tab === "home" || tab === "members") && <button className="button primary" onClick={() => open("member")} disabled={!writesEnabled}><Plus size={18} />新增会员</button>}{tab === "ledger" && <button className="button secondary" onClick={() => void exportLedger()} disabled={!data || (!localEnabled && !online) || exporting}>{exporting ? <LoaderCircle className="spinning" size={17} /> : <Download size={17} />}导出流水</button>}</div></div>
        {loading && !data ? <div className="loading-state"><LoaderCircle size={30} className="spinning" /><h2>{localEnabled ? "正在打开本地账本" : "正在连接你的云端店铺"}</h2><p>加载会员与经营数据…</p></div> : !data ? <section className="panel"><EmptyState icon={<Cloud size={40} />} title={localEnabled ? "本地账本暂时无法加载" : "连接云端后，开始管理店铺"} text={loadError || "请检查网络并重新加载。"}><button className="button primary" onClick={() => void reload()}><RefreshCw size={17} />重新连接</button></EmptyState></section> : <>
        {tab === "home" && <>
          <div className="overview-grid"><section className="today-card"><div className="today-card-top"><span><i />今日经营</span><span>{today.replaceAll("-", ".")}</span></div><div className="today-total"><span>实际收到的钱 <span className="subtle-white">含办卡与充值</span></span><div><small>¥</small>{money(data.summary.todayCashReceivedCents)}</div></div><div className="today-stats"><div><span>划卡服务金额</span><strong>{yuan(data.summary.todayServiceSpendCents)}</strong></div><div><span>服务笔数</span><strong>{data.summary.todayServices}<small> 笔</small></strong></div><div><span>新增会员</span><strong>{data.summary.todayNewMembers}<small> 位</small></strong></div></div><span className="till-mark" aria-hidden="true">丝</span></section><section className="member-overview panel"><div className="section-label"><Users size={18} />会员与储值<button className="text-button" onClick={() => setTab("members")} aria-label="查看会员"><ArrowUpRight size={18} /></button></div><div className="member-total"><strong>{data.summary.memberCount}</strong><span>位会员</span><span className="tag neutral">累计</span></div><div className="asset-row"><span>卡内储值总额</span><strong>{yuan(data.summary.totalBalanceCents)}</strong></div><div className="asset-row"><span>已开会员卡</span><strong>{cards.length}<small> 张</small></strong></div><p className="asset-footnote">卡内余额是尚未完成服务的金额。</p></section></div>
          <section className="quick-actions" aria-label="快捷操作"><button disabled={!writesEnabled} onClick={() => open("consume")}><span className="quick-icon teal"><Scissors size={25} /></span><div><strong>划卡消费</strong><span>服务完成，记一笔</span></div><ArrowUpRight size={18} /></button><button disabled={!writesEnabled} onClick={() => open("card")}><span className="quick-icon orange"><CreditCard size={25} /></span><div><strong>会员办卡</strong><span>开卡并记录收款</span></div><ArrowUpRight size={18} /></button><button disabled={!writesEnabled} onClick={() => open("recharge")}><span className="quick-icon purple"><Wallet size={25} /></span><div><strong>充值</strong><span>实收与赠送分开记</span></div><ArrowUpRight size={18} /></button><button onClick={() => { setTab("members"); setSearch(""); }}><span className="quick-icon blue"><Search size={25} /></span><div><strong>查找会员</strong><span>姓名、手机或卡号</span></div><ArrowUpRight size={18} /></button></section>
          <div className="detail-grid"><section className="panel ledger-panel"><div className="section-heading"><div><h2>最近流水</h2><p>办卡、充值、划卡后自动记账</p></div><button className="text-button" onClick={() => setTab("ledger")}>全部流水<ArrowRight size={15} /></button></div>{transactions.length ? <div className="ledger-list">{transactions.slice(0, 6).map(transaction => transactionRow(transaction, true))}</div> : <div className="ledger-empty"><div className="empty-illustration"><ReceiptText size={31} /></div><h3>添加第一位会员，开始记账</h3><p>保存会员资料，再为熟客办理储值卡。</p><button className="button secondary small" onClick={() => open("member")} disabled={!writesEnabled}><UserPlus size={16} />新增会员</button></div>}<div className="panel-bottom-note"><ShieldCheck size={14} />原始流水保留，撤销通过冲正记录调整</div></section><div className="right-stack"><section className="panel trend-panel"><div className="section-heading"><div><h2>近 7 天实收</h2><p>{localEnabled ? "本地完整流水，按日统计" : "完整云端流水，按日统计"}</p></div><span className="trend-legend"><i />实收</span></div><div className="bar-chart" role="img" aria-label={`近7天实收：${week.map(day => `${day.label} ${yuan(day.value)}`).join("，")}`}><div className="chart-grid"><span>{yuan(weekMax > 1 ? weekMax : 0)}</span><span>¥0</span></div>{week.map((day, index) => <div className="bar-item" key={day.key}><div className="bar-space"><span className={`bar ${index === 6 ? "today" : ""} ${day.value === 0 ? "zero" : ""}`} title={`${day.label} ${yuan(day.value)}`} style={{ height: `${day.value > 0 ? Math.max(day.value / weekMax * 100, 4) : 4}%` }} /></div><small>{index === 6 ? "今天" : day.label}</small></div>)}</div>{!transactions.length && <span className="chart-empty-text">记录第一笔收款后，在这里查看趋势</span>}</section><section className="care-card"><span className="care-icon"><Bell size={21} /></span><div><h3>会员卡余额提醒</h3><p>{lowCards.length ? `${lowCards.length} 张卡余额不高于 ${yuan(data.settings.lowBalanceCents)}` : "目前没有低余额会员卡"}</p></div><button className="icon-button" aria-label="查看会员卡提醒" onClick={() => { setTab("members"); setCardFilter("low"); }}><ArrowRight size={18} /></button></section><div className="cloud-reassurance"><Cloud size={17} /><span>{localEnabled ? offlineStatus().pending ? `${offlineStatus().pending} 项本地记录待同步` : "本地账本已保存" : "数据已同步云端"}</span><small>更新于 {dateTime(data.serverTime)}</small></div></div></div>
        </>}
        {tab === "members" && <section className="panel members-panel"><div className="member-toolbar"><label className="search-box"><Search size={19} /><input aria-label="搜索会员姓名、手机号或卡号" placeholder="搜索姓名、手机号或卡号" value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button" aria-label="清空搜索" onClick={() => setSearch("")}><X size={16} /></button>}</label><span className="result-count">共 {filteredMembers.length} 位会员</span></div><div className="filter-chips"><button className={!showDeleted ? "selected" : ""} aria-pressed={!showDeleted} onClick={() => { setShowDeleted(false); setCardFilter("all"); }}>正常会员</button><button className={showDeleted ? "selected" : ""} aria-pressed={showDeleted} onClick={() => { setShowDeleted(true); setCardFilter("all"); }}>已删除</button></div><div className="filter-chips" aria-label="会员筛选">{[{ id: "all", label: "全部会员" }, { id: "low", label: "低余额提醒" }, { id: "none", label: "待办卡" }].map(item => <button key={item.id} className={cardFilter === item.id ? "selected" : ""} onClick={() => setCardFilter(item.id)} aria-pressed={cardFilter === item.id}>{item.label}</button>)}</div>{filteredMembers.length ? <div className="member-list"><div className="member-table-heading"><span>会员</span><span>持有会员卡</span><span>卡内余额</span><span>操作</span></div>{filteredMembers.map(member => { const own = cards.filter(card => card.memberId === member.id); const balance = own.reduce((sum, card) => sum + card.balanceCents, 0); return <div className="member-row" key={member.id}><button className="member-identity" onClick={() => open("detail", member.id)}><span className="member-avatar">{initial(member.name)}</span><span><strong>{member.name}</strong><small>{member.phone || "姓名登记"}</small></span></button><div className="member-cards">{own.length ? own.map(card => <span className="tag stored" key={card.id}>{card.name}</span>) : <span className="muted">尚未办卡</span>}</div><div className="member-balance"><strong>{yuan(balance)}</strong></div><button className="text-button" onClick={() => open("detail", member.id)}>查看<ChevronRight size={15} /></button></div>; })}</div> : <EmptyState icon={<Users size={33} />} title={showDeleted ? "没有已删除的会员" : members.length ? "没有找到符合条件的会员" : "第一位会员，从这里开始"} text={showDeleted ? "删除后的会员会保留在这里，可以查看和恢复。" : members.length ? "试试其他姓名、手机号、卡号或筛选条件。" : "填写姓名或手机号，再为熟客开一张储值卡。"}>{!showDeleted && !members.length && <button className="button primary" disabled={!writesEnabled} onClick={() => open("member")}><Plus size={17} />新增会员</button>}</EmptyState>}</section>}
        {tab === "ledger" && <section className="panel ledger-full-panel"><div className="ledger-toolbar"><div className="filter-chips">{[{ id: "all", label: "全部流水" }, { id: "recharge", label: "充值与办卡" }, { id: "consume", label: "划卡消费" }, { id: "reversal", label: "撤销记录" }].map(item => <button key={item.id} className={ledgerFilter === item.id ? "selected" : ""} onClick={() => setLedgerFilter(item.id)} aria-pressed={ledgerFilter === item.id}>{item.label}</button>)}</div><div className="date-filters"><label>起始日期<input type="date" aria-label="流水起始日期" value={fromDate} onChange={event => setFromDate(event.target.value)} max={toDate || today} /></label><span>—</span><label>结束日期<input type="date" aria-label="流水结束日期" value={toDate} onChange={event => setToDate(event.target.value)} min={fromDate} max={today} /></label>{(fromDate || toDate) && <button className="icon-button" aria-label="清空日期筛选" onClick={() => { setFromDate(""); setToDate(""); }}><X size={17} /></button>}</div></div><div className="ledger-summary"><div><span>已加载流水实收</span><strong>{yuan(filteredTransactions.reduce((sum, transaction) => sum + transaction.cashReceivedCents, 0))}</strong></div><div><span>已加载服务金额</span><strong>{yuan(filteredTransactions.reduce((sum, transaction) => sum + transaction.serviceSpendCents, 0))}</strong></div><div><span>记录数</span><strong>{filteredTransactions.length}<small> 笔</small></strong></div></div>{ledgerLoading && !filteredTransactions.length ? <div className="ledger-loading"><LoaderCircle size={22} className="spinning" />{localEnabled ? "正在加载本地流水…" : "正在加载云端流水…"}</div> : ledgerError ? <div className="full-empty"><p role="alert">{ledgerError}</p><button className="button secondary" onClick={() => void loadLedger()}>重试</button></div> : filteredTransactions.length ? <div className="ledger-list">{filteredTransactions.map(transaction => transactionRow(transaction))}</div> : <EmptyState icon={<ReceiptText size={38} />} title={transactions.length ? "这个日期内还没有流水" : "这里会记录每一笔生意"} text={transactions.length ? "调整日期或流水类型查看其他记录。" : localEnabled ? "完成办卡、充值或划卡，记录先保存到本地，可手动同步。" : "完成办卡、充值或划卡，记录自动同步到云端。"} />}{ledgerCursor && !ledgerError && <div className="ledger-pagination"><button className="button secondary" disabled={ledgerLoading || (!localEnabled && !online)} onClick={() => void loadLedger(ledgerCursor)}>{ledgerLoading ? <LoaderCircle className="spinning" size={17} /> : <ChevronDown size={17} />}{ledgerLoading ? "加载中…" : "加载更多流水"}</button></div>}<div className="panel-bottom-note"><ShieldCheck size={14} />实收是收到的钱，划卡服务金额是本次服务的价值。赠送金额另行记录。<span>已加载 {ledgerRows.length} 笔，导出包含所选日期全部记录</span></div></section>}
        {tab === "settings" && <div className="settings-grid"><section className="panel settings-section"><div className="section-heading"><div><h2>店铺资料</h2><p>店名、地址与余额提醒</p></div><button className="text-button" onClick={() => open("shop")} disabled={!writesEnabled}>编辑<ArrowUpRight size={15} /></button></div><div className="shop-profile"><span className="shop-logo"><Scissors size={31} strokeWidth={2.5} /></span><div><h3>{data.settings.shopName}</h3><span>店主专属管理端</span></div></div><dl className="settings-values"><div><dt>联系电话</dt><dd>{data.settings.phone || "待填写"}</dd></div><div><dt>店铺地址</dt><dd>{data.settings.address || "待填写"}</dd></div><div><dt>低余额提醒</dt><dd>≤ {yuan(data.settings.lowBalanceCents)}</dd></div></dl></section><section className="panel settings-section service-section"><div className="section-heading"><div><h2>服务项目</h2><p>划卡时选择，金额可调整</p></div><button className="text-button" onClick={() => open("service")} disabled={!writesEnabled}><Plus size={16} />添加</button></div>{data.services.length ? <div className="service-list">{data.services.map(service => <div className="service-row" key={service.id}><span className="service-icon"><Scissors size={17} /></span><div><strong>{service.name}{!service.active && <span className="tag neutral">已停用</span>}</strong></div><b>{yuan(service.priceCents)}</b><button className="text-button" onClick={() => open("service", service.id)} disabled={!writesEnabled}>编辑</button></div>)}</div> : <div className="mini-empty"><Scissors size={28} /><p>先添加一个服务项目，例如洗剪吹。</p><button className="button secondary small" disabled={!writesEnabled} onClick={() => open("service")}><Plus size={16} />添加服务</button></div>}</section>{localEnabled ? <><OfflinePanel storage/><div className="account-line"><span>当前账号</span><strong>{user.email}</strong><button className="text-button" disabled={loggingOut} onClick={logout}><LogOut size={15}/>退出登录</button></div></> : <section className="panel settings-section security-section"><div className="section-heading"><div><h2>云端与账号</h2><p>手机随身带，账目云端存</p></div><ShieldCheck size={21} /></div><div className="security-line"><CheckCheck size={20} /><div><strong>云端保存</strong><p>会员、卡余额与流水保存于云端数据库；手机不长期缓存业务数据。</p></div></div><div className="security-line"><ShieldCheck size={20} /><div><strong>登录保护与操作记录</strong><p>通过店主管理账号登录，会员资料与账目需要验证后访问。充值、消费需核对，撤销保留原始流水。</p></div></div><div className="account-line"><span>当前账号</span><strong>{user.email}</strong><button className="text-button" disabled={loggingOut} onClick={logout}><LogOut size={15} />退出登录</button></div></section>}<section className="install-card"><span className="install-icon"><Smartphone size={29} /></span><h2>{nativeInstalled ? "已安装安卓应用" : installed ? "已添加到手机桌面" : "把千丝万缕装进手机"}</h2><p>添加到安卓手机桌面，<br />下次开店时直接打开。</p>{installed ? <span className="installed-label"><Check size={16} />已安装</span> : installPrompt ? <button className="button primary" onClick={async () => { await installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === "accepted") { setInstalled(true); setInstallPrompt(null); } }}><ArrowDownToLine size={17} />安装到手机桌面</button> : <div className="install-instructions"><b>安卓 Chrome 浏览器</b><span>打开页面 → 右上角「⋮」菜单 →<br />「添加到主屏幕」或「安装应用」</span></div>}<small>{localEnabled ? "可离线使用，点击双向同步更新其他设备账目。" : "使用时需要联网，核对最新余额。"}</small></section></div>}
        </>}
        <footer className="page-footer"><span><Scissors size={12} />千丝万缕</span><span>{localEnabled ? "本地保存 · 手动双向同步 · 1.1.0" : "会员与账目保存在云端"}</span></footer>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="手机管理导航">{nav.map(item => <button className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined}><item.icon size={21} /><span>{item.label}</span></button>)}</nav>
    {toast && <div className="toast" role="status"><Check size={18} /><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast("")}><X size={15} /></button></div>}
    <dialog ref={dialogRef} aria-labelledby="dialog-title" className={`app-dialog ${modal?.kind === "detail" ? "detail-dialog" : ""}`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      {modal?.kind === "detail" && detailMember ? <><DialogHeader close={close} busy={busy}>会员详情</DialogHeader><div className="dialog-body"><div className="detail-profile"><span className="member-avatar large">{initial(detailMember.name)}</span><div><h3>{detailMember.name}</h3><span>{detailMember.phone || "姓名登记"}</span><small>加入于 {dateKey(detailMember.createdAt)}</small></div><button className="button secondary small" onClick={() => open("card", detailMember.id)} disabled={!writesEnabled || !!detailMember.deletedAt || detailCards.length > 0}><Plus size={15} />{detailCards.length ? "已办卡" : "办卡"}</button></div>{detailMember.note && <p className="member-note">备注：{detailMember.note}</p>}<h4 className="detail-heading">会员卡 <span>{detailCards.length} 张</span></h4>{detailCards.length ? detailCards.map(card => <div className="detail-card" key={card.id}><div className="detail-card-top"><span><CreditCard size={17} />{card.name}</span><small>储值卡</small></div><div className="detail-card-value"><small>¥</small>{money(card.balanceCents)}</div><div className="detail-card-note">本金 {yuan(card.cashBalanceCents)} · 赠送 {yuan(card.giftBalanceCents)}</div><div className="detail-card-bottom"><small>{cardNo(card.id)}</small><div><button className="button secondary small" disabled={!writesEnabled || !!detailMember.deletedAt} onClick={() => open("recharge", detailMember.id, { cardId: card.id })}>充值</button><button className="button primary small" disabled={!writesEnabled || !!detailMember.deletedAt} onClick={() => open("consume", detailMember.id, { cardId: card.id })}><Scissors size={14} />划卡</button></div></div></div>) : <div className="mini-empty"><CreditCard size={30} /><p>这位会员还没有卡，办一张开始记账。</p></div>}<h4 className="detail-heading">最近流水</h4>{transactions.some(transaction => transaction.memberId === detailMember.id) ? <div className="detail-transactions">{transactions.filter(transaction => transaction.memberId === detailMember.id).slice(0, 10).map(transaction => transactionRow(transaction))}</div> : <p className="muted">尚无交易记录</p>}<div className="member-delete-actions"><p>{detailMember.deletedAt ? "此会员已删除，资料与历史流水仍保留。" : "删除前请核对余额，历史流水会保留。"}</p><button className="button secondary" disabled={!writesEnabled} onClick={() => open(detailMember.deletedAt ? "restoreMember" : "deleteMember",detailMember.id)}>{detailMember.deletedAt ? "恢复会员" : "删除会员"}</button></div></div></> : modal && <form onSubmit={submit} noValidate><DialogHeader close={close} busy={busy}>{reviewing ? "确认这笔操作" : ({ member: "新增会员", card: "会员办卡", recharge: "会员充值", consume: "划卡消费", reversal: "撤销流水", shop: "编辑店铺资料", service: modal.id ? "编辑服务项目" : "添加服务项目", detail: "会员详情", deleteMember:"删除会员", restoreMember:"恢复会员" }[modal.kind])}</DialogHeader><div className="dialog-body">
      {reviewing ? <div className="review-panel"><span className={`review-icon ${modal.kind === "reversal" ? "orange" : ""}`}>{modal.kind === "reversal" ? <RotateCcw size={27} /> : <CheckCheck size={27} />}</span><h3>{modal.kind === "card" ? "确认开通会员卡" : modal.kind === "recharge" ? "确认收到充值款" : modal.kind === "consume" ? "确认完成本次服务" : "确认撤销这笔流水"}</h3><p>{modal.kind === "reversal" ? "会新增冲正记录，原始流水保留。" : localEnabled ? "确认后更新本地卡余额，并保存流水，可稍后同步。" : "确认后更新卡余额，并记入云端流水。"}</p><dl className="review-values"><div><dt>会员</dt><dd>{selectedMember?.name || memberMap.get(selectedTransaction?.memberId || "")?.name}</dd></div><div><dt>会员卡</dt><dd>{modal.kind === "card" ? form.cardName : selectedCard?.name || cardMap.get(selectedTransaction?.cardId || "")?.name}</dd></div>{["card", "recharge"].includes(modal.kind) && <><div><dt>实际收款</dt><dd className="review-money">{yuan(cents(form.paid, "实收金额"))}</dd></div><div><dt>赠送金额</dt><dd>{yuan(cents(form.gift || "0", "赠送金额", true))}</dd></div><div><dt>计入卡内余额</dt><dd>{yuan(cents(form.paid, "实收金额") + cents(form.gift || "0", "赠送金额", true))}</dd></div></>}{modal.kind === "consume" && <><div><dt>服务项目</dt><dd>{services.find(service => service.id === form.serviceId)?.name}</dd></div><div><dt>本次扣款</dt><dd className="review-money">{yuan(cents(form.amount, "消费金额"))}</dd></div><div><dt>操作后余额</dt><dd>{yuan((selectedCard?.balanceCents || 0) - cents(form.amount, "消费金额"))}</dd></div></>}{modal.kind === "reversal" && <><div><dt>原始金额</dt><dd>{yuan(selectedTransaction?.amountCents || 0)}</dd></div><div><dt>原始时间</dt><dd>{selectedTransaction ? dateTime(selectedTransaction.createdAt) : ""}</dd></div></>}{form.note && <div><dt>{modal.kind === "reversal" ? "撤销原因" : "备注"}</dt><dd>{form.note}</dd></div>}</dl><div className="inline-info"><ShieldCheck size={16} />核对会员和金额后，再确认提交。</div></div> : <>
      {(modal.kind === "deleteMember" || modal.kind === "restoreMember") && <><div className="reversal-warning"><ShieldCheck size={22} /><div><strong>{actionMember?.name}{actionMember?.phone && actionMember.phone !== actionMember.name ? ` · ${actionMember.phone}` : ""}</strong><p>{modal.kind === "deleteMember" ? "确认从正常会员列表删除？会员资料、会员卡和历史流水会保留，可在已删除列表恢复。有余额的会员不能删除。" : "确认恢复这位会员？恢复后可以继续办卡、充值和划卡，历史记录保持不变。"}</p></div></div></>}
      {modal.kind === "member" && <><div className="form-intro">一位会员一张储值卡，姓名或手机号选一项登记。</div><div className="filter-chips" aria-label="登记方式"><button type="button" disabled={locked} className={form.identifierType === "name" ? "selected" : ""} onClick={() => setValue("identifierType","name")}>用姓名登记</button><button type="button" disabled={locked} className={form.identifierType === "phone" ? "selected" : ""} onClick={() => setValue("identifierType","phone")}>用手机号登记</button></div>{form.identifierType === "phone" ? field("手机号 / 联系电话", "phone", {type:"tel",placeholder:"填写手机号即可",required:true,maxLength:20}) : field("会员姓名", "name", {placeholder:"填写姓名即可",required:true,maxLength:40})}{notes()}<label className="checkbox-field"><input type="checkbox" checked={form.continueCard === "yes"} onChange={event => setValue("continueCard", event.target.checked ? "yes" : "no")} disabled={locked} />保存后继续办卡</label></>}
      {modal.kind === "card" && <>{memberSelect()}{!members.length && <div className="inline-info">还没有会员，<button type="button" className="text-button" onClick={() => open("member")}>先添加一位会员</button></div>}<div className="form-card-explainer"><CreditCard size={23} /><div><strong>储值会员卡</strong><p>充值到卡内，服务后按金额划扣。</p></div></div>{field("会员卡名称", "cardName", { placeholder: "例如：储值会员卡", required: true, maxLength: 50 })}{field("实际收款（元）", "paid", { type: "number", placeholder: "0.00", required: true })}{field("赠送金额（元）", "gift", { type: "number", placeholder: "0.00", hint: "本金与赠送金额分别保存，合计计入卡内余额。" })}</>}
      {(modal.kind === "recharge" || modal.kind === "consume") && <>{cardSelect()}{selectedCard && <div className="selected-card-info"><CreditCard size={19} /><span>{selectedCard.name}<small>{cardNo(selectedCard.id)}</small></span><strong>{yuan(selectedCard.balanceCents)}</strong></div>}{modal.kind === "recharge" ? <>{field("实际收款（元）", "paid", { type: "number", placeholder: "0.00", required: true })}{field("赠送金额（元）", "gift", { type: "number", placeholder: "0.00", hint: "赠送计入卡内余额，实际收款单独统计。" })}</> : <><label className="field"><span>服务项目 <b>*</b></span><select value={form.serviceId} required disabled={locked} onChange={event => { const service = services.find(item => item.id === event.target.value); setForm(current => ({ ...current, serviceId: event.target.value, amount: service ? (service.priceCents / 100).toFixed(2) : "" })); setFormError(""); }}><option value="">请选择服务</option>{services.map(service => <option key={service.id} value={service.id}>{service.name} · {yuan(service.priceCents)}</option>)}</select></label>{!services.length && <div className="inline-info">还没有服务项目。<button type="button" className="text-button" onClick={() => { setTab("settings"); open("service"); }}>添加服务</button></div>}{field("本次扣款金额（元）", "amount", { type: "number", placeholder: "0.00", required: true, hint: "从卡内余额扣除，可修改实际消费金额。" })}</>}{notes()}</>}
      {modal.kind === "reversal" && <><div className="reversal-warning"><RotateCcw size={22} /><div><strong>通过冲正，调整这笔账</strong><p>消费撤销会退回余额；充值撤销会扣回充值金额。原始记录继续保留。</p></div></div><dl className="review-values"><div><dt>会员</dt><dd>{memberMap.get(selectedTransaction?.memberId || "")?.name}</dd></div><div><dt>原始金额</dt><dd>{yuan(selectedTransaction?.amountCents || 0)}</dd></div><div><dt>原始时间</dt><dd>{selectedTransaction ? dateTime(selectedTransaction.createdAt) : ""}</dd></div></dl>{notes("撤销原因", true)}</>}
      {modal.kind === "shop" && <>{field("店铺名称", "shopName", { placeholder: "你的理发店叫什么", required: true, maxLength: 50 })}{field("联系电话", "shopPhone", { type: "tel", maxLength: 25 })}{field("店铺地址", "address", { maxLength: 200 })}{field("低余额提醒（元）", "lowBalance", { type: "number", required: true })}<div className="inline-info">卡内余额不高于此值时，会出现在会员提醒中。</div></>}
      {modal.kind === "service" && <>{field("服务名称", "name", { placeholder: "例如：洗剪吹", required: true, maxLength: 50 })}{field("服务价格（元）", "price", { type: "number", placeholder: "0.00", required: true })}{modal.id && <label className="checkbox-field"><input type="checkbox" checked={form.active === "true"} onChange={event => setValue("active", String(event.target.checked))} disabled={locked} />启用此服务项目</label>}</>}
      </>}
      {formError && <div className="form-error" role="alert">{formError}</div>}{!online && <div className="form-error" role="alert">网络已断开，联网后再提交。</div>}
      </div><div className="dialog-footer"><button type="button" className="button secondary" disabled={locked} onClick={reviewing ? () => setReviewing(false) : close}>{reviewing ? "返回修改" : "取消"}</button><button type="submit" className={`button ${["reversal", "deleteMember"].includes(modal.kind) ? "danger" : "primary"}`} disabled={busy || !writesEnabled}>{busy ? <LoaderCircle className="spinning" size={17} /> : reviewing ? <Check size={17} /> : <ArrowRight size={17} />}{busy ? "正在保存…" : uncertain ? "重试同一笔操作" : reviewing ? "确认提交" : modal.kind === "deleteMember" ? "确认删除" : modal.kind === "restoreMember" ? "确认恢复" : ["card", "recharge", "consume", "reversal"].includes(modal.kind) ? "核对并继续" : modal.kind === "member" && form.continueCard === "yes" ? "保存并办卡" : "保存"}</button></div><div className="dialog-security"><Cloud size={12} />{localEnabled ? "保存到本地，可离线记账" : "保存至云端，记账需要联网"}</div></form>}
    </dialog>
  </div>;
}





