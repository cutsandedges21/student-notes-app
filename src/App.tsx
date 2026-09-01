import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ClassesPage from './pages/ClassesPage'
import ClassPage from './pages/ClassPage'
import EditorPage from './pages/EditorPage'
import SharedLinkPage from './pages/SharedLinkPage'
import UpgradePage from './pages/UpgradePage'
import { IntroSplash } from './components/IntroSplash'

/**
 * No route requires an account. Signed-out visitors get the full app backed by
 * browser storage; signing in migrates that work into their account. Auth
 * screens remain reachable, but nothing redirects to them.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Over every route: a share link is an arrival too. */}
        <IntroSplash />
        <Routes>
          <Route path="/" element={<Navigate to="/classes" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Public: a share link must open without an account. What the
              visitor can then do is decided by the owner's chosen mode and
              whether they sign in. */}
          <Route path="/shared/:token" element={<SharedLinkPage />} />
          <Route path="/upgrade" element={<UpgradePage />} />
          <Route path="/classes" element={<ClassesPage />} />
          <Route path="/classes/:classSlug" element={<ClassPage />} />
          {/*
            /classes/biology-101/lecture-5--<id>

            Readable, but addressed by the note's id: the slug in front of it
            is decoration and may be stale. Renaming a note therefore cannot
            change where it lives, which is what stopped a rename from
            reloading the document out from under whoever was typing.

            One segment, because the router matches whole segments -- the two
            halves are separated in lib/noteRef. Slug-only addresses from
            before this shipped still resolve, and are rewritten to the
            canonical form on load.
          */}
          <Route path="/classes/:classSlug/:noteRef" element={<EditorPage />} />
          {/*
            A note shared with you. Same page, same editor, same everything --
            it is a real note you have real access to, so it opens in the real
            editor rather than in a read-only imitation of one. It has no class
            segment because the class belongs to whoever shared it.
          */}
          <Route path="/notes/:noteRef" element={<EditorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
