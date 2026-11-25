import { KeyRoundIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { Fragment, useState } from "react";
import type { Agent, Credential } from "@/client/api-types";
import { formatDateTime } from "@/client/formatting";
import {
	useAgents,
	useCreateAgent,
	useRegisterCredential,
	useUpdateCredential,
} from "@/client/queries";
import { useMediaQuery } from "@/client/use-media-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type RegisterDraft = {
	externalId: string;
	appId: string;
	envelope: "pusher" | "reviewer";
	privateKeyPem: string;
	expectedRepository: string;
};

const EMPTY_DRAFT: RegisterDraft = {
	externalId: "",
	appId: "",
	envelope: "pusher",
	privateKeyPem: "",
	expectedRepository: "",
};

export function AgentsPage() {
	const { data: agents, isPending, error } = useAgents();

	return (
		<div className="space-y-4">
			{error && <p className="text-sm text-destructive">{error.message}</p>}
			{isPending ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : agents ? (
				<>
					<CreateAgent />
					{agents.map((agent) => (
						<AgentCard key={agent.id} agent={agent} />
					))}
					{agents.length === 0 && (
						<p className="text-sm text-muted-foreground">
							No agents yet — create one above.
						</p>
					)}
				</>
			) : null}
		</div>
	);
}

function CreateAgent() {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [error, setError] = useState<string | null>(null);
	const createAgent = useCreateAgent();

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		try {
			await createAgent.mutateAsync({ name, email });
			setName("");
			setEmail("");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Create agent</CardTitle>
				<CardDescription>
					Add a new GitHub App agent to the system.
				</CardDescription>
			</CardHeader>
			<form onSubmit={submit}>
				<CardContent className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="agent-name">Name</Label>
						<Input
							id="agent-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="agent-email">Email</Label>
						<Input
							id="agent-email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
						/>
					</div>
					{error && (
						<p className="text-sm text-destructive sm:col-span-2">{error}</p>
					)}
				</CardContent>
				<CardFooter className="justify-end">
					<Button type="submit" disabled={createAgent.isPending}>
						{createAgent.isPending ? "Creating…" : "Create agent"}
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}

function AgentCard({ agent }: { agent: Agent }) {
	// The 6-column table only fits md+; phones get stacked cards (F9).
	const isTableLayout = useMediaQuery("(min-width: 768px)");

	return (
		<Card>
			<CardHeader>
				<CardTitle>{agent.name}</CardTitle>
				<CardDescription>{agent.email}</CardDescription>
			</CardHeader>
			<CardContent>
				{agent.credentials.length === 0 ? (
					<p className="text-sm text-muted-foreground">No credentials.</p>
				) : isTableLayout ? (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Envelope</TableHead>
									<TableHead>Installation</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Key ver.</TableHead>
									<TableHead>Last used</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{agent.credentials.map((cred) => (
									<CredentialRow key={cred.id} agentId={agent.id} cred={cred} />
								))}
							</TableBody>
						</Table>
					</div>
				) : (
					<div className="grid gap-3">
						{agent.credentials.map((cred) => (
							<CredentialCard key={cred.id} agentId={agent.id} cred={cred} />
						))}
					</div>
				)}
			</CardContent>
			<CardFooter className="justify-end">
				<RegisterCredentialDialog agentId={agent.id} />
			</CardFooter>
		</Card>
	);
}

function useCredentialToggle(agentId: string, cred: Credential) {
	const [error, setError] = useState<string | null>(null);
	const updateCredential = useUpdateCredential();

	async function toggle() {
		setError(null);
		try {
			await updateCredential.mutateAsync({
				agentId,
				credentialId: cred.id,
				status: cred.status === "active" ? "disabled" : "active",
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	return { toggle, error, isPending: updateCredential.isPending };
}

function CredentialRow({
	agentId,
	cred,
}: {
	agentId: string;
	cred: Credential;
}) {
	const { toggle, error, isPending } = useCredentialToggle(agentId, cred);

	return (
		<Fragment>
			<TableRow>
				<TableCell className="capitalize">{cred.envelope}</TableCell>
				<TableCell>
					<code className="font-mono text-xs">{cred.externalId ?? "—"}</code>
				</TableCell>
				<TableCell>
					<StatusBadge status={cred.status} />
				</TableCell>
				<TableCell>v{cred.keyVersion}</TableCell>
				<TableCell className="text-muted-foreground">
					{cred.lastUsedAt ? formatDateTime(cred.lastUsedAt) : "never"}
				</TableCell>
				<TableCell className="text-right">
					<div className="flex items-center justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={toggle}
							disabled={isPending}
						>
							{cred.status === "active" ? "Disable" : "Enable"}
						</Button>
						<RotateCredentialSheet agentId={agentId} cred={cred} />
					</div>
				</TableCell>
			</TableRow>
			{error && (
				// Full-width error row: mutation failures must not be clipped by
				// the nowrap cells or the Actions column's overflow scroll.
				<TableRow className="hover:bg-transparent">
					<TableCell
						colSpan={6}
						className="py-1 whitespace-normal text-xs text-destructive"
					>
						{error}
					</TableCell>
				</TableRow>
			)}
		</Fragment>
	);
}

function CredentialCard({
	agentId,
	cred,
}: {
	agentId: string;
	cred: Credential;
}) {
	const { toggle, error, isPending } = useCredentialToggle(agentId, cred);

	return (
		<div className="rounded-lg border p-3">
			<div className="flex items-center justify-between gap-2">
				<Badge variant="outline" className="capitalize">
					{cred.envelope}
				</Badge>
				<StatusBadge status={cred.status} />
			</div>
			<dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
				<dt className="text-muted-foreground">Installation</dt>
				<dd>
					<code className="font-mono">{cred.externalId ?? "—"}</code>
				</dd>
				<dt className="text-muted-foreground">Key version</dt>
				<dd>v{cred.keyVersion}</dd>
				<dt className="text-muted-foreground">Last used</dt>
				<dd className="text-muted-foreground">
					{cred.lastUsedAt ? formatDateTime(cred.lastUsedAt) : "never"}
				</dd>
			</dl>
			<div className="mt-3 flex items-center justify-end gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={toggle}
					disabled={isPending}
				>
					{cred.status === "active" ? "Disable" : "Enable"}
				</Button>
				<RotateCredentialSheet agentId={agentId} cred={cred} />
			</div>
			{error && <p className="mt-2 text-xs text-destructive">{error}</p>}
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const isActive = status === "active";
	return <Badge variant={isActive ? "default" : "secondary"}>{status}</Badge>;
}

function RegisterCredentialDialog({ agentId }: { agentId: string }) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<RegisterDraft>(EMPTY_DRAFT);
	const [error, setError] = useState<string | null>(null);
	const registerCredential = useRegisterCredential();

	async function register(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		try {
			await registerCredential.mutateAsync({
				agentId,
				externalId: draft.externalId,
				appId: draft.appId,
				envelope: draft.envelope,
				privateKeyPem: draft.privateKeyPem,
				expectedRepo: draft.expectedRepository || undefined,
			});
			setDraft(EMPTY_DRAFT);
			setOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={<Button type="button" variant="outline" size="sm" />}
			>
				<PlusIcon />
				Register credential
			</DialogTrigger>
			<DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
				<form onSubmit={register}>
					<DialogHeader>
						<DialogTitle>Register credential</DialogTitle>
						<DialogDescription>
							Add a GitHub App credential to this agent.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor={`register-installation-${agentId}`}>
									Installation id
								</Label>
								<Input
									id={`register-installation-${agentId}`}
									value={draft.externalId}
									onChange={(e) =>
										setDraft({ ...draft, externalId: e.target.value })
									}
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor={`register-app-${agentId}`}>App id</Label>
								<Input
									id={`register-app-${agentId}`}
									value={draft.appId}
									onChange={(e) =>
										setDraft({ ...draft, appId: e.target.value })
									}
									required
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor={`register-envelope-${agentId}`}>Envelope</Label>
							<Select
								value={draft.envelope}
								onValueChange={(value) =>
									setDraft({
										...draft,
										envelope: value as RegisterDraft["envelope"],
									})
								}
							>
								<SelectTrigger id={`register-envelope-${agentId}`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="pusher">
										pusher (contents: write + pull_requests: write)
									</SelectItem>
									<SelectItem value="reviewer">
										reviewer (contents: read + pull_requests: write)
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label htmlFor={`register-key-${agentId}`}>
								Private key PEM — verified against GitHub at registration
							</Label>
							<Textarea
								id={`register-key-${agentId}`}
								value={draft.privateKeyPem}
								onChange={(e) =>
									setDraft({ ...draft, privateKeyPem: e.target.value })
								}
								rows={6}
								placeholder={
									"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"
								}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor={`register-repo-${agentId}`}>
								Expected repository (optional, e.g. Eden-Kukuana-PLC/kukuana)
							</Label>
							<Input
								id={`register-repo-${agentId}`}
								value={draft.expectedRepository}
								onChange={(e) =>
									setDraft({ ...draft, expectedRepository: e.target.value })
								}
							/>
						</div>
						{error && <p className="text-sm text-destructive">{error}</p>}
					</div>
					<DialogFooter>
						<Button type="submit" disabled={registerCredential.isPending}>
							<KeyRoundIcon />
							{registerCredential.isPending ? "Verifying…" : "Register"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RotateCredentialSheet({
	agentId,
	cred,
}: {
	agentId: string;
	cred: Credential;
}) {
	const [open, setOpen] = useState(false);
	const [rotatePem, setRotatePem] = useState("");
	const [rotateAppId, setRotateAppId] = useState("");
	const [error, setError] = useState<string | null>(null);
	const updateCredential = useUpdateCredential();

	async function rotate(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		try {
			await updateCredential.mutateAsync({
				agentId,
				credentialId: cred.id,
				privateKeyPem: rotatePem,
				appId: rotateAppId,
				envelope: cred.envelope === "reviewer" ? "reviewer" : "pusher",
			});
			setRotatePem("");
			setRotateAppId("");
			setOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger
				render={<Button type="button" variant="outline" size="sm" />}
			>
				<RefreshCwIcon />
				Rotate
			</SheetTrigger>
			<SheetContent className="overflow-y-auto">
				<form onSubmit={rotate}>
					<SheetHeader>
						<SheetTitle>Rotate credential</SheetTitle>
						<SheetDescription>
							Replace the key for {cred.envelope} installation{" "}
							{cred.externalId ?? "—"}.
						</SheetDescription>
					</SheetHeader>
					<div className="grid gap-4 p-4">
						<div className="space-y-2">
							<Label htmlFor={`rotate-app-${cred.id}`}>App id</Label>
							<Input
								id={`rotate-app-${cred.id}`}
								value={rotateAppId}
								onChange={(e) => setRotateAppId(e.target.value)}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor={`rotate-key-${cred.id}`}>
								New private key PEM
							</Label>
							<Textarea
								id={`rotate-key-${cred.id}`}
								value={rotatePem}
								onChange={(e) => setRotatePem(e.target.value)}
								rows={6}
								placeholder="New private key PEM"
								required
							/>
						</div>
						{error && <p className="text-sm text-destructive">{error}</p>}
					</div>
					<SheetFooter>
						<Button type="submit" disabled={updateCredential.isPending}>
							<RefreshCwIcon />
							{updateCredential.isPending ? "Rotating…" : "Rotate key"}
						</Button>
					</SheetFooter>
				</form>
			</SheetContent>
		</Sheet>
	);
}
