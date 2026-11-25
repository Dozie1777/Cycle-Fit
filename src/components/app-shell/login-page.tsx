import { LoginForm } from "./login-form";

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
	return (
		<div className="grid min-h-svh lg:grid-cols-2">
			<div className="relative hidden bg-muted lg:flex flex-col justify-between p-10 overflow-hidden">
				<div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-secondary/10 to-background" />
				<div className="relative z-10">
					<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-foreground font-bold">
						A
					</div>
				</div>
				<div className="relative z-10">
					<h2 className="text-2xl font-bold text-foreground">
						Code Review Bot
					</h2>
					<p className="text-muted-foreground">
						AI-powered design and code review studio.
					</p>
				</div>
			</div>
			<div className="flex flex-col gap-4 p-6 md:p-10 items-center justify-center">
				<div className="w-full max-w-sm space-y-6">
					<div className="flex flex-col gap-2 text-center lg:text-left">
						<h1 className="text-2xl font-bold">Sign in</h1>
						<p className="text-sm text-muted-foreground">Admin access only.</p>
					</div>
					<LoginForm onSuccess={onSignedIn} />
				</div>
			</div>
		</div>
	);
}
