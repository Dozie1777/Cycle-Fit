import { type FormEvent, useState } from "react";
import { authClient } from "@/client/auth-client";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ onSuccess }: { onSuccess?: () => void }) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const { error: signInError } = await authClient.signIn.email({
				email,
				password,
			});
			if (signInError) {
				setError(signInError.message ?? "Sign-in failed");
				return;
			}
			onSuccess?.();
		} catch {
			setError("Sign-in failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Sign in</CardTitle>
				<CardDescription>
					Enter your admin credentials to continue.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={submit} className="flex flex-col gap-4">
					<div className="grid gap-2">
						<Label htmlFor="email">Email</Label>
						<Input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							autoComplete="username"
							placeholder="admin@example.com"
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							autoComplete="current-password"
						/>
					</div>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<Button type="submit" disabled={busy}>
						{busy ? "Signing in…" : "Sign in"}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
