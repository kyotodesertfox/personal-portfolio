/*
  REACT ISLAND
  This file is a regular React component - useState, events, everything you know.
  The difference is HOW it gets loaded. In index.astro we import it with
  client:load which tells Astro: "hydrate this component in the browser."
  Everything else on the page is static HTML. Only this component runs JS.
*/

import { useState } from 'react';

const TABS = ['New Site', 'Existing Site'];
const NEW_SITE_STEPS = 3;

// Strips non-digits and formats as XXX-XXX-XXXX as you type
const formatPhone = (val) => {
  const digits = val.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isValidPhone = (v) => /^\d{3}-\d{3}-\d{4}$/.test(v);

const initialNewSite = {
  name: '',
  email: '',
  phone: '',
  purpose: '',
  url: '',
  comments: '',
  file: null,
};

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs uppercase tracking-widest font-bold text-slate-500">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-amber-400 transition-colors w-full";

export default function OrderModal() {
  const [open, setOpen]       = useState(false);
  const [tab, setTab]         = useState(0);
  const [step, setStep]       = useState(0);
  const [form, setForm]       = useState(initialNewSite);
  const [submitted, setSubmitted] = useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const stepValid = [
    form.name.trim() && isValidEmail(form.email) && isValidPhone(form.phone),
    form.purpose && form.url.trim(),
    form.comments.trim(),
  ];

  const close = () => {
    setOpen(false);
    setTab(0);
    setStep(0);
    setForm(initialNewSite);
    setSubmitted(false);
  };

  const submit = async () => {
    const data = new FormData();
    data.append('form-name', 'project-intake');
    data.append('name',     form.name);
    data.append('email',    form.email);
    data.append('phone',    form.phone);
    data.append('purpose',  form.purpose);
    data.append('url',      form.url);
    data.append('comments', form.comments);
    if (form.file) data.append('file', form.file);

    await fetch('/', { method: 'POST', body: data });
    setSubmitted(true);
  };

  return (
    <>
      {/* TRIGGER BUTTON - replaces "Let's Talk" */}
      <button
        onClick={() => setOpen(true)}
        className="inline-block bg-amber-400 hover:bg-amber-300 text-slate-900 font-black uppercase tracking-widest text-sm px-8 py-4 transition-colors"
      >
        Build With Us +
      </button>

      {/* MODAL OVERLAY */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80">
          <div className="bg-white w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

            {/* HEADER */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100">
              <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Start a Project</h2>
              <button
                onClick={close}
                className="text-slate-400 hover:text-slate-700 font-bold text-xl leading-none transition-colors"
              >
                x
              </button>
            </div>

            {/* TABS */}
            <div className="flex border-b border-slate-100">
              {TABS.map((t, i) => (
                <button
                  key={t}
                  onClick={() => { setTab(i); setStep(0); }}
                  className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-colors border-b-2 ${
                    tab === i
                      ? 'border-amber-400 text-amber-500'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* BODY */}
            <div className="flex-1 overflow-y-auto px-8 py-6">

              {/* NEW SITE FLOW */}
              {tab === 0 && !submitted && (
                <div className="space-y-5">

                  {/* STEP INDICATOR */}
                  <div className="flex items-center gap-2 mb-6">
                    {Array.from({ length: NEW_SITE_STEPS }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 transition-colors ${i <= step ? 'bg-amber-400' : 'bg-slate-100'}`}
                      />
                    ))}
                  </div>

                  {step === 0 && (
                    <>
                      <p className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-4">Step 1 of 3 - Contact Info</p>
                      <Field label="Full Name">
                        <input className={inputClass} placeholder="John Smith" value={form.name} onChange={e => set('name', e.target.value)} />
                      </Field>
                      <Field label="Email Address">
                        <input
                          className={`${inputClass} ${form.email && !isValidEmail(form.email) ? 'border-red-300' : ''}`}
                          type="email"
                          placeholder="john@example.com"
                          value={form.email}
                          onChange={e => set('email', e.target.value)}
                        />
                        {form.email && !isValidEmail(form.email) && (
                          <p className="text-red-400 text-xs mt-1">Enter a valid email address</p>
                        )}
                      </Field>
                      <Field label="Phone Number">
                        <input
                          className={`${inputClass} ${form.phone && !isValidPhone(form.phone) ? 'border-red-300' : ''}`}
                          type="tel"
                          placeholder="904-555-0000"
                          value={form.phone}
                          onChange={e => set('phone', formatPhone(e.target.value))}
                        />
                        {form.phone && !isValidPhone(form.phone) && (
                          <p className="text-red-400 text-xs mt-1">Enter a 10-digit number</p>
                        )}
                      </Field>
                    </>
                  )}

                  {step === 1 && (
                    <>
                      <p className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-4">Step 2 of 3 - Your Site</p>
                      <Field label="Site Purpose">
                        <div className="flex gap-3">
                          {['Personal', 'Business'].map(opt => (
                            <button
                              key={opt}
                              onClick={() => set('purpose', opt)}
                              className={`flex-1 py-3 text-sm font-bold uppercase tracking-wider border transition-colors ${
                                form.purpose === opt
                                  ? 'border-amber-400 bg-amber-50 text-amber-600'
                                  : 'border-slate-200 text-slate-400 hover:border-slate-400'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </Field>
                      <Field label="Desired URL / Domain">
                        <input className={inputClass} placeholder="mysite.com" value={form.url} onChange={e => set('url', e.target.value)} />
                      </Field>
                    </>
                  )}

                  {step === 2 && (
                    <>
                      <p className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-4">Step 3 of 3 - Preferences</p>
                      <Field label="Comments, Color Schemes, Layout Preferences">
                        <textarea
                          className={`${inputClass} resize-none`}
                          rows={5}
                          placeholder="Describe your vision - colors, style, pages you need, anything that helps..."
                          value={form.comments}
                          onChange={e => set('comments', e.target.value)}
                        />
                      </Field>
                      <Field label="Supporting Documents (PDF)">
                        <input
                          type="file"
                          accept=".pdf"
                          className="text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:border file:border-slate-200 file:text-xs file:font-bold file:uppercase file:tracking-wider file:bg-slate-50 hover:file:bg-amber-50 hover:file:border-amber-400 file:transition-colors cursor-pointer"
                          onChange={e => set('file', e.target.files?.[0] ?? null)}
                        />
                      </Field>
                    </>
                  )}
                </div>
              )}

              {/* EXISTING SITE - placeholder for now */}
              {tab === 1 && !submitted && (
                <div className="space-y-5">
                  <p className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-4">Existing Site</p>
                  <Field label="Full Name">
                    <input className={inputClass} placeholder="John Smith" />
                  </Field>
                  <Field label="Email Address">
                    <input className={inputClass} type="email" placeholder="john@example.com" />
                  </Field>
                  <Field label="Current Site URL">
                    <input className={inputClass} placeholder="mysite.com" />
                  </Field>
                  <Field label="What needs to change?">
                    <textarea className={`${inputClass} resize-none`} rows={4} placeholder="Describe what you need updated, fixed, or added..." />
                  </Field>
                </div>
              )}

              {/* SUCCESS */}
              {submitted && (
                <div className="py-8 text-center">
                  <p className="text-4xl font-black uppercase tracking-tight text-slate-900 mb-3">Received.</p>
                  <p className="text-slate-500 text-sm">I'll be in touch within one business day.</p>
                </div>
              )}

            </div>

            {/* FOOTER */}
            {!submitted && (
              <div className="px-8 py-5 border-t border-slate-100 flex justify-between items-center">
                <button
                  onClick={() => step > 0 ? setStep(s => s - 1) : close()}
                  className="text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors"
                >
                  {step > 0 ? 'Back' : 'Cancel'}
                </button>

                {tab === 0 ? (
                  step < NEW_SITE_STEPS - 1 ? (
                    <button
                      onClick={() => setStep(s => s + 1)}
                      disabled={!stepValid[step]}
                      className="bg-amber-400 text-slate-900 font-black uppercase tracking-widest text-xs px-6 py-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-amber-300"
                    >
                      Next +
                    </button>
                  ) : (
                    <button
                      onClick={submit}
                      disabled={!stepValid[step]}
                      className="bg-slate-900 text-white font-black uppercase tracking-widest text-xs px-6 py-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-slate-700"
                    >
                      Submit
                    </button>
                  )
                ) : (
                  <button
                    onClick={submit}
                    className="bg-slate-900 hover:bg-slate-700 text-white font-black uppercase tracking-widest text-xs px-6 py-3 transition-colors"
                  >
                    Submit
                  </button>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </>
  );
}
