import { UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { useAdmins, useCreateAdmin } from "@/client/queries";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export function AdminsPage() {
	const { data: admins, isPending, error } = useAdmins();

	return (
		<div className="space-y-4">
			{error && <p className="text-sm text-destructive">{error.message}</p>}
			{isPending ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : admins ? (
				<>
					<CreateAdmin />
					<Card>
						<CardHeader>
							<CardTitle>Admins</CardTitle>
							<CardDescription>
								Users with full administrative access.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{admins.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									No admins yet — create one above.
								</p>
							) : (
								<div className="overflow-x-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Name</TableHead>
												<TableHead>Email</TableHead>
												<TableHead>Created</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{admins.map((admin) => (
												<TableRow key={admin.id}>
													<TableCell>{admin.name}</TableCell>
													<TableCell>{admin.email}</TableCell>
													<TableCell className="text-muted-foreground">
														{new Date(admin.createdAt).toLocaleString()}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							)}
						</CardContent>
					</Card>
				</>
			) : null}
		</div>
	);
}

function CreateAdmin() {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const createAdmin = useCreateAdmin();

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		try {
			await createAdmin.mutateAsync({ name, email, password });
			setName("");
			setEmail("");
			setPassword("");
			setOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<Card>
			<CardHeader>
				<div className="space-y-1">
					<CardTitle>Admins</CardTitle>
					<CardDescription>
						Create and manage administrator accounts.
					</CardDescription>
				</div>
				<CardAction>
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger render={<Button type="button" size="sm" />}>
							<UserPlusIcon />
							Create admin
						</DialogTrigger>
						<DialogContent className="max-w-lg">
							<form onSubmit={submit}>
								<DialogHeader>
									<DialogTitle>Create admin</DialogTitle>
									<DialogDescription>
										Share the initial password with the new admin out-of-band —
										they can change it after signing in.
									</DialogDescription>
								</DialogHeader>
								<div className="grid gap-4 py-4">
									<div className="space-y-2">
										<Label htmlFor="admin-name">Name</Label>
										<Input
											id="admin-name"
											value={name}
											onChange={(e) => setName(e.target.value)}
											required
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="admin-email">Email</Label>
										<Input
											id="admin-email"
											type="email"
											value={email}
											onChange={(e) => setEmail(e.target.value)}
											required
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="admin-password">Initial password</Label>
										<Input
											id="admin-password"
											type="password"
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											autoComplete="new-password"
											minLength={8}
											required
										/>
									</div>
									{error && <p className="text-sm text-destructive">{error}</p>}
								</div>
								<DialogFooter>
									<Button type="submit" disabled={createAdmin.isPending}>
										{createAdmin.isPending ? "Creating…" : "Create admin"}
									</Button>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>
				</CardAction>
			</CardHeader>
		</Card>
	);
}
