import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AuthShell, FormError } from '@/web/components/AuthShell'
import { Button } from '@/web/components/ui/button'
import { Input } from '@/web/components/ui/input'
import { Label } from '@/web/components/ui/label'
import { useSignup } from '@/web/lib/queries'

export default function Signup() {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const signup = useSignup()

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    signup.mutate({ phone, name, password })
  }

  return (
    <AuthShell
      title="Create account"
      description="A 10-digit number is assumed to be Indian."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="text-primary font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
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
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="text-muted-foreground text-xs">At least 8 characters.</p>
        </div>
        <FormError message={signup.error?.message} />
        <Button type="submit" disabled={signup.isPending} className="mt-1">
          {signup.isPending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  )
}
