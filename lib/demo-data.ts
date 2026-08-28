export const people = {
  josh: { name: "Josh Wyrick", username: "@joshwyrick", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&auto=format&fit=crop" },
  mike: { name: "Mike Thompson", username: "@mikethompson", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop" },
  sarah: { name: "Sarah Johnson", username: "@sarahj", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&auto=format&fit=crop" },
  jess: { name: "Jess Williams", username: "@jessw", avatar: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=300&auto=format&fit=crop" },
  taylor: { name: "Taylor Smith", username: "@taylors", avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop" },
  alex: { name: "Alex Jordan", username: "@alexj", avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=300&auto=format&fit=crop" },
  emma: { name: "Emma Reed", username: "@emmar", avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&auto=format&fit=crop" }
};

export const stories = [
  { name: "Family", image: people.sarah.avatar },
  { name: "Besties", image: people.jess.avatar },
  { name: "Vegas 2026", image: people.mike.avatar },
  { name: "Work Crew", image: people.taylor.avatar },
  { name: "Cousins", image: people.emma.avatar }
];

export const posts = [
  {
    id: "p1",
    author: people.mike,
    time: "2h",
    audience: "Family",
    image: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1400&auto=format&fit=crop",
    caption: "Sunset dinners and better conversations.",
    likes: 24,
    comments: 6,
    carousel: "1/8"
  },
  {
    id: "p2",
    author: people.sarah,
    time: "5h",
    audience: "Vegas 2026",
    image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1400&auto=format&fit=crop",
    caption: "Already ready for the next one. 🔥",
    likes: 38,
    comments: 11,
    carousel: "1/5"
  }
];

export const galleryImages = [
  "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1526772662000-3f88f10405ff?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1519671282429-b44660ead0a7?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=900&auto=format&fit=crop"
];

export const events = [
  {
    id: "vegas-2026",
    title: "Vegas 2026",
    date: "May 30 – Jun 2, 2026",
    shortDate: "MAY 30",
    place: "Las Vegas, NV",
    members: 12,
    image: "https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?w=1400&auto=format&fit=crop"
  },
  {
    id: "emma-birthday",
    title: "Emma's Birthday Dinner 🎉",
    date: "May 25, 2026 · 7:00 PM",
    shortDate: "MAY 25",
    place: "The Harbor House",
    members: 14,
    image: "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=1400&auto=format&fit=crop"
  },
  {
    id: "cabin-weekend",
    title: "Cabin Weekend",
    date: "Jun 14 – Jun 16, 2026",
    shortDate: "JUN 14",
    place: "Big Bear Lake, CA",
    members: 9,
    image: "https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=1400&auto=format&fit=crop"
  },
  {
    id: "smith-wedding",
    title: "Smith Wedding",
    date: "Aug 10, 2026",
    shortDate: "AUG 10",
    place: "Santa Barbara, CA",
    members: 123,
    image: "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=1400&auto=format&fit=crop"
  }
];

export const conversations = [
  { id: "besties", name: "Besties", members: "6 members", person: people.jess, preview: "Mike: Weekend hike? 🔥", time: "10:15 AM", unread: 2 },
  { id: "sarah", name: "Sarah Johnson", members: "", person: people.sarah, preview: "See you Saturday!", time: "9:40 AM", unread: 1 },
  { id: "vegas", name: "Vegas Crew", members: "12 members", person: people.mike, preview: "Jess: I booked our tables", time: "Yesterday", unread: 0 },
  { id: "mom", name: "Mom", members: "", person: people.emma, preview: "Love you!", time: "Yesterday", unread: 0 },
  { id: "work", name: "Work Crew", members: "8 members", person: people.taylor, preview: "Alex: Don't forget meeting", time: "Tue", unread: 0 }
];

export const notifications = [
  { id: 1, person: people.mike, text: "liked your post.", time: "8m" },
  { id: 2, person: people.sarah, text: "commented: Looks amazing! 🔥", time: "43m" },
  { id: 3, person: people.jess, text: "invited you to an event · Cabin Weekend", time: "2h" },
  { id: 4, person: people.taylor, text: "mentioned you in a comment.", time: "1d" },
  { id: 5, person: people.alex, text: "sent you a message.", time: "1d" },
  { id: 6, person: people.emma, text: "Emma's Birthday Dinner starts in 3 days.", time: "May 20" }
];
