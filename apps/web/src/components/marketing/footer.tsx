import { Container } from './container';
import { Logo } from './logo';

const FOOTER_LINKS = {
  Products: ['Production', 'Inventory', 'Distribution', 'Retail Intelligence'],
  Company: ['About', 'Why Zentuva', 'Careers', 'Contact'],
  Resources: ['Documentation', 'API', 'Support', 'Status'],
};

const SOCIALS = ['X', 'LinkedIn', 'YouTube'];

export function Footer() {
  return (
    <footer className="border-t border-border/60 py-16">
      <Container>
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              The operating system powering the next generation of African manufacturing.
            </p>
            <div className="mt-6 flex gap-3">
              {SOCIALS.map((social) => (
                <a
                  key={social}
                  href="#"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary"
                  aria-label={social}
                >
                  {social.slice(0, 1)}
                </a>
              ))}
            </div>
          </div>

          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <div key={heading}>
              <p className="text-sm font-semibold text-foreground">{heading}</p>
              <ul className="mt-4 space-y-3">
                {links.map((link) => (
                  <li key={link}>
                    <a href="#" className="text-sm text-muted-foreground hover:text-foreground">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <p className="text-sm font-semibold text-foreground">Contact</p>
            <ul className="mt-4 space-y-3">
              <li>
                <a
                  href="mailto:hello@zentuva.com"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  hello@zentuva.com
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-muted-foreground hover:text-foreground">
                  Book a Demo
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-8 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Zentuva. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground">Made for African manufacturing.</p>
        </div>
      </Container>
    </footer>
  );
}
