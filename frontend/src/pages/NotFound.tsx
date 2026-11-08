import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center py-32 text-center">
      <div className="eyebrow mb-3">404</div>
      <h1 className="display text-[40px]">Page not found</h1>
      <p className="mt-3 text-muted">This address does not match any page in the console.</p>
      <Button asChild className="mt-8"><Link to="/command">Back to Command Center</Link></Button>
    </div>
  );
}
