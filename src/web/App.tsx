import { Navigate, Route, Routes } from 'react-router'
import Login from '@/web/routes/Login'
import Screenshots from '@/web/routes/Screenshots'
import Signup from '@/web/routes/Signup'
import { useMe } from '@/web/lib/queries'

export default function App() {
  const me = useMe()

  if (me.isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-dvh items-center justify-center text-sm">
        Loading…
      </div>
    )
  }

  if (!me.data) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Screenshots user={me.data} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
