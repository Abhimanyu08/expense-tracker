import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AuthShell, FormError } from '@/web/components/AuthShell'
import { Button } from '@/web/components/ui/button'
import { Input } from '@/web/components/ui/input'
import { Label } from '@/web/components/ui/label'
import { useLogin } from '@/web/lib/queries'

export default function Login() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const login = useLogin()

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    login.mutate({ phone, password })
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in with the number you registered."
      footer={
        <>
          No account?{' '}
          <Link to="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <FormError message={login.error?.message} />
        <Button type="submit" disabled={login.isPending} className="mt-1">
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  )
}
