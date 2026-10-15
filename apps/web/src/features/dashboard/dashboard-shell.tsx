"use client";

import * as Avatar from "@radix-ui/react-avatar";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Switch from "@radix-ui/react-switch";
import {
  Barcode,
  Boxes,
  ChevronDown,
  FileStack,
  Files,
  Layers3,
  LogOut,
  Menu,
  Moon,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  ScanLine,
  Sun,
  Tags,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import type { AuthUser } from "@/features/auth/contracts";
import { authApi } from "@/features/auth/browser-api";
import { Logo } from "@/features/marketing/logo";
import {
  accountNavigation,
  currentNavigationLabel,
  isNavigationItemActive,
  primaryNavigation,
  type DashboardNavigationItem,
} from "./navigation";
import styles from "./dashboard.module.css";

const workspaceIcons = [
  Barcode,
  Boxes,
  FileStack,
  Files,
  Layers3,
  PackageCheck,
  Printer,
  ScanLine,
  Tags,
  Truck,
] as const;
const randomWorkspaceIcon = Math.floor(Math.random() * workspaceIcons.length);
const subscribeToWorkspaceIcon = () => () => undefined;
const getWorkspaceIcon = () => randomWorkspaceIcon;
const getServerWorkspaceIcon = () => 0;

export function DashboardShell({
  user,
  children,
}: {
  readonly user: AuthUser;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  function changeTheme(dark: boolean) {
    setTheme(dark ? "dark" : "light");
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await authApi.logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div
      className={styles.shell}
      data-theme={theme}
      data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
    >
      <aside className={styles.desktopSidebar}>
        <SidebarContent
          collapsed={sidebarCollapsed}
          pathname={pathname}
          user={user}
          onNavigate={() => undefined}
          onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        />
      </aside>

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.mobileOverlay} />
          <Dialog.Content className={styles.mobileSidebar}>
            <Dialog.Title className="sr-only">
              Dashboard navigation
            </Dialog.Title>
            <Dialog.Close
              className={styles.mobileClose}
              aria-label="Close menu"
            >
              <X aria-hidden="true" size={19} strokeWidth={1.8} />
            </Dialog.Close>
            <SidebarContent
              collapsed={false}
              pathname={pathname}
              user={user}
              onNavigate={() => setMobileOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className={styles.viewport}>
        <header className={styles.topbar}>
          <div className={styles.topbarStart}>
            <button
              className={styles.mobileTrigger}
              type="button"
              aria-label="Open dashboard menu"
              onClick={() => setMobileOpen(true)}
            >
              <Menu aria-hidden="true" size={19} strokeWidth={1.8} />
            </button>
            <div>
              <span className={styles.topbarEyebrow}>WORKSPACE</span>
              <strong>{currentNavigationLabel(pathname)}</strong>
            </div>
          </div>

          <div className={styles.topbarEnd}>
            <span className={styles.systemStatus}>
              <i aria-hidden="true" /> LOCAL ENGINE READY
            </span>
            <div className={styles.themeControl}>
              <Sun aria-hidden="true" size={14} strokeWidth={1.8} />
              <Switch.Root
                className={styles.themeSwitch}
                checked={theme === "dark"}
                onCheckedChange={changeTheme}
                aria-label="Use dark dashboard theme"
              >
                <Switch.Thumb className={styles.themeThumb} />
              </Switch.Root>
              <Moon aria-hidden="true" size={14} strokeWidth={1.8} />
            </div>
            <ProfileMenu
              user={user}
              signingOut={signingOut}
              onSignOut={signOut}
            />
          </div>
        </header>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

function SidebarContent({
  collapsed,
  pathname,
  user,
  onNavigate,
  onToggleCollapse,
}: {
  readonly collapsed: boolean;
  readonly pathname: string;
  readonly user: AuthUser;
  readonly onNavigate: () => void;
  readonly onToggleCollapse?: () => void;
}) {
  const workspaceIcon = useSyncExternalStore(
    subscribeToWorkspaceIcon,
    getWorkspaceIcon,
    getServerWorkspaceIcon,
  );
  const WorkspaceIcon = workspaceIcons[workspaceIcon] ?? Barcode;
  return (
    <div className={styles.sidebarInner}>
      <div className={styles.sidebarBrand}>
        <Logo href="/dashboard" wordmark />
        {onToggleCollapse ? (
          <button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            className={styles.sidebarCollapse}
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            type="button"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" size={17} strokeWidth={1.6} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={17} strokeWidth={1.6} />
            )}
          </button>
        ) : null}
      </div>

      <div className={styles.workspaceIdentity}>
        <Avatar.Root className={styles.workspaceAvatar}>
          <Avatar.Fallback>
            <WorkspaceIcon aria-hidden="true" size={20} strokeWidth={1.8} />
          </Avatar.Fallback>
        </Avatar.Root>
        <div>
          <strong>{workspaceName(user.email)}</strong>
          <span>Personal workspace</span>
        </div>
      </div>

      <nav className={styles.navigation} aria-label="Dashboard">
        <span className={styles.navigationLabel}>WORKSPACE</span>
        {primaryNavigation.map((item) => (
          <NavigationLink
            key={item.href}
            item={item}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}

        <span className={styles.navigationLabel}>ACCOUNT</span>
        {accountNavigation
          .filter((item) => !item.adminOnly || user.role === "admin")
          .map((item) => (
            <NavigationLink
              key={item.href}
              item={item}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
      </nav>

      <div className={styles.sidebarFoot}>
        <div>
          <span>ACCOUNT STATUS</span>
          <strong>{user.emailVerified ? "VERIFIED" : "ACTIVE"}</strong>
        </div>
        <Link href="/dashboard/subscription" onClick={onNavigate}>
          VIEW PLANS
        </Link>
      </div>
    </div>
  );
}

function NavigationLink({
  item,
  pathname,
  onNavigate,
}: {
  readonly item: DashboardNavigationItem;
  readonly pathname: string;
  readonly onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      className={styles.navigationLink}
      data-active={isNavigationItemActive(pathname, item)}
      href={item.href}
      onClick={onNavigate}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
      <span>{item.shortLabel}</span>
    </Link>
  );
}

function ProfileMenu({
  user,
  signingOut,
  onSignOut,
}: {
  readonly user: AuthUser;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={styles.profileTrigger}>
        <Avatar.Root className={styles.profileAvatar}>
          <Avatar.Fallback>{initials(user.email)}</Avatar.Fallback>
        </Avatar.Root>
        <span>{user.email}</span>
        <ChevronDown aria-hidden="true" size={15} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={styles.profileMenu}
          align="end"
          sideOffset={8}
        >
          <div className={styles.profileSummary}>
            <strong>{user.email}</strong>
            <span>{user.role === "admin" ? "Administrator" : "User"}</span>
          </div>
          <DropdownMenu.Separator className={styles.menuSeparator} />
          <DropdownMenu.Item asChild>
            <Link className={styles.profileMenuItem} href="/dashboard/settings">
              Account settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link className={styles.profileMenuItem} href="/dashboard/security">
              Security & sessions
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={styles.menuSeparator} />
          <DropdownMenu.Item
            className={styles.profileMenuItem}
            disabled={signingOut}
            onSelect={() => void onSignOut()}
          >
            <LogOut aria-hidden="true" size={15} />
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

function workspaceName(email: string): string {
  const localPart = email.split("@")[0] ?? "Workspace";
  return `${localPart.slice(0, 18)}${localPart.length > 18 ? "…" : ""}`;
}
