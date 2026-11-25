"use strict";

/* =====================================================
   BOOKNEST 2.0
   Fictional bookstore | Local browser application
   No backend or paid service required
===================================================== */

const DB_KEY = "booknest_database_v3";
const LEGACY_DB_KEY = "booknest_database_v2";

const ISBN_BOOKS = [
  ["Atomic Habits","James Clear","Self Help",399,599,45,"9780735211292"],
  ["The Psychology of Money","Morgan Housel","Business",349,499,32,"9789390166268"],
  ["Ikigai","Hector Garcia","Self Help",299,450,24,"9781786330895"],
  ["The Alchemist","Paulo Coelho","Fiction",249,399,50,"9780062315007"],
  ["Rich Dad Poor Dad","Robert Kiyosaki","Business",329,499,18,"9781612680194"],
  ["It Ends With Us","Colleen Hoover","Romance",379,599,15,"9781501110368"],
  ["The Silent Patient","Alex Michaelides","Fiction",349,499,29,"9781250301697"],
  ["Wings of Fire","A.P.J. Abdul Kalam","Self Help",199,299,60,"9788173711466"],
  ["The Hobbit","J.R.R. Tolkien","Fiction",399,599,12,"9780547928227"],
  ["The Art of War","Sun Tzu","Business",179,299,40,"9781590302255"],
  ["Pride and Prejudice","Jane Austen","Romance",229,349,22,"9780141439518"],
  ["The Palace of Illusions","Chitra Banerjee","Mythology",329,499,20,"9781400096206"],
  ["Think and Grow Rich","Napoleon Hill","Business",249,399,20,"9781585424337"],
  ["The Midnight Library","Matt Haig","Fiction",319,499,27,"9780525559474"],
  ["Preloved Classics Box","Various Authors","Preloved",499,799,8,""]
];

function coverURL(isbn) {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
}

/* ORIGINAL BOOK COVER LOOKUP — ISBN first, then exact title + author.
   Covers are saved to the product record and reused everywhere.
   No random or unrelated image is ever substituted. */
const coverLookupQueue = new Set();

function normalizeBookText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function findBookCover(book) {
  const isbn = String(book.isbn || "").replace(/[^0-9X]/gi, "");
  const title = String(book.title || "").trim();
  const author = String(book.author || "").trim();

  if (isbn) {
    try {
      const response = await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=title,author_name,cover_i,isbn&limit=10`);
      if (response.ok) {
        const docs = (await response.json()).docs || [];
        const exact = docs.find(doc => doc.cover_i && Array.isArray(doc.isbn) &&
          doc.isbn.some(value => String(value).replace(/[^0-9X]/gi, "") === isbn));
        const match = exact || docs.find(doc => doc.cover_i);
        if (match) return `https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg`;
      }
    } catch (error) {
      console.warn("ISBN cover lookup failed:", error);
    }
  }

  if (!title || !author) return "";
  try {
    const params = new URLSearchParams({
      title, author, fields: "title,author_name,cover_i,isbn", limit: "20"
    });
    const response = await fetch(`https://openlibrary.org/search.json?${params}`);
    if (!response.ok) return "";
    const docs = (await response.json()).docs || [];
    const wantedTitle = normalizeBookText(title);
    const wantedAuthor = normalizeBookText(author);
    const match = docs.find(doc => {
      if (!doc.cover_i || normalizeBookText(doc.title) !== wantedTitle) return false;
      const authors = (doc.author_name || []).map(normalizeBookText);
      return authors.some(name => name === wantedAuthor || name.includes(wantedAuthor) || wantedAuthor.includes(name));
    });
    return match ? `https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg` : "";
  } catch (error) {
    console.warn("Title/author cover lookup failed:", error);
    return "";
  }
}

function coverMarkup(book) {
  const title = escapeHTML(book.title);
  if (book.image) {
    return `<img src="${escapeHTML(book.image)}" alt="Book cover for ${title}"
      loading="lazy" onerror="handleCoverError(${Number(book.id)}, this)">`;
  }
  const status = ["pending","searching"].includes(book.coverStatus)
    ? "FINDING ORIGINAL COVER…" : "ORIGINAL COVER UNAVAILABLE";
  return `<div class="cover-unavailable"><strong>${title}</strong><span>${status}</span></div>`;
}

async function refreshBookCover(bookId, force = false) {
  const book = db.products.find(item => Number(item.id) === Number(bookId));
  if (!book || coverLookupQueue.has(book.id)) return;
  if (!force && book.image && book.coverStatus === "found") return;

  coverLookupQueue.add(book.id);
  book.coverStatus = "searching";
  saveDB();
  try {
    const found = await findBookCover(book);
    const current = db.products.find(item => Number(item.id) === Number(bookId));
    if (current) {
      current.image = found || "";
      current.coverStatus = found ? "found" : "unavailable";
    }
  } catch (error) {
    const current = db.products.find(item => Number(item.id) === Number(bookId));
    if (current) {
      current.image = "";
      current.coverStatus = "unavailable";
    }
  } finally {
    coverLookupQueue.delete(bookId);
    saveDB();
    refreshActiveStorePage();
  }
}

function refreshMissingCovers() {
  (async () => {
    for (const book of db.products) {
      if (!book.image && book.coverStatus !== "unavailable") {
        await refreshBookCover(book.id);
        await new Promise(resolve => setTimeout(resolve, 180));
      }
    }
  })();
}

function handleCoverError(bookId, imageElement) {
  const book = db.products.find(item => Number(item.id) === Number(bookId));
  if (!book) return;
  book.image = "";
  book.coverStatus = "unavailable";
  saveDB();
  const placeholder = document.createElement("div");
  placeholder.className = "cover-unavailable";
  placeholder.innerHTML = `<strong>${escapeHTML(book.title)}</strong><span>RETRYING ORIGINAL COVER…</span>`;
  imageElement.replaceWith(placeholder);
  refreshBookCover(bookId, true);
}

function refreshActiveStorePage() {
  const active = document.querySelector(".page.active");
  if (!active) return;
  const page = active.id.replace(/Page$/, "");
  const renderers = {
    home: renderHome, shop: renderShop, wishlist: renderWishlist,
    product: () => {
      const root = document.querySelector("#productDetails [data-product-id]");
      if (root) viewProduct(Number(root.dataset.productId));
    },
    cart: renderCart, checkout: renderCheckout, orders: renderOrders
  };
  if (renderers[page]) renderers[page]();
}

function makeProducts() {
  return ISBN_BOOKS.map((b,i)=>({
    id:i+1,
    title:b[0],
    author:b[1],
    category:b[2],
    price:b[3],
    mrp:b[4],
    stock:b[5],
    isbn:b[6],
    image:"",
    coverStatus:"pending",
    cost:Math.round(b[3]*0.55),
    rating:4.6,
    tag:i===0?"Bestseller":"Popular",
    description:`Discover ${b[0]}, a carefully selected title from the BOOKNEST collection.`
  }));
}

function initialDatabase() {
  return {
    products:makeProducts(),
    orders:[],
    customers:[],
    cart:[],
    wishlist:[],
    coupons:[
      {code:"READ50",type:"fixed",value:50,min:300,active:true},
      {code:"BOOK10",type:"percent",value:10,min:500,active:true}
    ],
    expenses:[],
    suppliers:[],
    employees:[],
    returns:[],
    subscribers:[],
    notifications:["BOOKNEST demo store initialized."],
    settings:{storeName:"BOOKNEST",freeShipping:999,gst:5},
    customerSession:null,
    adminSession:false
  };
}

function loadDB() {
  try {
    const saved = localStorage.getItem(DB_KEY) || localStorage.getItem(LEGACY_DB_KEY);
    if (!saved) return initialDatabase();
    const parsed = JSON.parse(saved);
    const defaults = initialDatabase();
    const merged = {...defaults, ...parsed};
    merged.products = (Array.isArray(parsed.products) ? parsed.products : defaults.products).map(p => ({
      ...p,
      image: (p.coverUrl || p.image || "").includes("/b/isbn/") ? "" : (p.image || p.coverUrl || ""),
      coverStatus: (p.coverUrl || p.image || "").includes("/b/isbn/")
        ? "pending" : (p.coverStatus || (p.coverUrl || p.image ? "found" : "pending"))
    }));
    ["orders","customers","cart","wishlist","coupons","expenses","suppliers","employees","returns","subscribers","notifications"]
      .forEach(key => { if (!Array.isArray(merged[key])) merged[key] = defaults[key]; });
    merged.settings = {...defaults.settings, ...(parsed.settings || {})};
    return merged;
  } catch(e) {
    console.error("Database error:", e);
    return initialDatabase();
  }
}

let db=loadDB();
let activeAdminTab="dashboard";
let appliedCoupon=null;

function escapeHTML(value) {
  return String(value??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

function money(value) {
  return "₹"+Number(value||0).toLocaleString("en-IN");
}

function today() {
  return new Date().toISOString().slice(0,10);
}

function toast(message) {
  const el=document.getElementById("toast");
  el.textContent=message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>el.classList.remove("show"),2500);
}

function isAdminVisible() {
  return !document.getElementById("adminPanel").classList.contains("hidden");
}

/* CENTRAL DATA SAVE AND LIVE REFRESH */

function saveDB() {
  try {
    localStorage.setItem(DB_KEY,JSON.stringify(db));
    updateCartCount();

    if(isAdminVisible()) {
      renderAdminContent();
    }

  } catch(e) {
    console.error(e);
    toast("Unable to save. Browser storage may be full.");
  }
}

function updateCartCount() {
  const el=document.getElementById("cartCount");
  if(el) el.textContent=db.cart.reduce((s,i)=>s+i.qty,0);
}

window.addEventListener("storage",event=>{
  if(event.key===DB_KEY) {
    db=loadDB();
    updateCartCount();

    if(isAdminVisible()) renderAdminContent();
    if(document.getElementById("homePage").classList.contains("active")) renderHome();
    if(document.getElementById("shopPage").classList.contains("active")) renderShop();
    if(document.getElementById("cartPage").classList.contains("active")) renderCart();
    if(document.getElementById("wishlistPage").classList.contains("active")) renderWishlist();
    if(document.getElementById("ordersPage").classList.contains("active")) renderOrders();
  }
});

/* NAVIGATION */

function showPage(name) {
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));

  const page=document.getElementById(name+"Page");
  if(!page) return;

  page.classList.add("active");
  document.getElementById("adminPanel").classList.add("hidden");
  document.getElementById("storefront").classList.remove("hidden");
  document.getElementById("storeFooter").classList.remove("hidden");

  document.querySelector(".nav-links").classList.remove("open");

  window.scrollTo({top:0,behavior:"smooth"});

  const renderers={
    home:renderHome,
    shop:renderShop,
    wishlist:renderWishlist,
    cart:renderCart,
    checkout:renderCheckout,
    account:renderAccount,
    orders:renderOrders,
    returns:renderReturns
  };

  if(renderers[name]) renderers[name]();
}

function toggleMobileMenu() {
  document.querySelector(".nav-links").classList.toggle("open");
}

/* PRODUCT CATALOGUE AND REAL BOOK COVERS */

function productCard(p) {
  const wished=db.wishlist.includes(p.id);

  return `
  <article class="product-card">
    <div class="book-cover">
      <span class="product-tag">${escapeHTML(p.tag||p.category)}</span>
      <button class="wish-btn" onclick="toggleWishlist(${p.id})">${wished?"♥":"♡"}</button>
      ${coverMarkup(p)}
    </div>
    <div class="product-info">
      <span class="product-category">${escapeHTML(p.category)}</span>
      <h3><a href="#" onclick="viewProduct(${p.id});return false">${escapeHTML(p.title)}</a></h3>
      <div class="product-author">${escapeHTML(p.author)}</div>
      <div class="product-price">
        ${money(p.price)}
        <span class="old-price">${money(p.mrp)}</span>
      </div>
      <button class="add-btn" ${p.stock<=0?"disabled":""} onclick="addToCart(${p.id})">
        ${p.stock>0?"ADD TO BAG":"OUT OF STOCK"}
      </button>
    </div>
  </article>`;
}

function renderHome() {
  document.getElementById("featuredProducts").innerHTML=
    db.products.filter(p=>p.stock>0).slice(0,4).map(productCard).join("");
}

let currentCategory="All";

function filterCategory(category) {
  currentCategory=category;
  showPage("shop");
}

function renderShop() {
  const search=(document.getElementById("searchInput")?.value||"").toLowerCase();
  const max=document.getElementById("priceFilter")?.value||"all";
  const stock=document.getElementById("stockFilter")?.checked||false;
  const sort=document.getElementById("sortFilter")?.value||"default";

  let items=db.products.filter(p=>
    (currentCategory==="All"||p.category===currentCategory)&&
    (p.title+" "+p.author+" "+p.category).toLowerCase().includes(search)&&
    (max==="all"||p.price<=Number(max))&&
    (!stock||p.stock>0)
  );

  if(sort==="low") items.sort((a,b)=>a.price-b.price);
  if(sort==="high") items.sort((a,b)=>b.price-a.price);
  if(sort==="name") items.sort((a,b)=>a.title.localeCompare(b.title));

  document.getElementById("productCount").textContent=
    `${items.length} books found`;

  document.getElementById("shopProducts").innerHTML=items.length?
    items.map(productCard).join():
    `<div class="empty-state"><h2>No books found</h2></div>`;
}

function viewProduct(id) {
  const p=db.products.find(x=>x.id===id);
  if(!p) return;

  showPage("product");
  document.getElementById("productDetails").innerHTML=`
    <div class="product-detail" data-product-id="${p.id}">
      <div class="detail-image">
        ${coverMarkup(p)}
      </div>
      <div class="detail-info">
        <span class="product-category">${escapeHTML(p.category)}</span>
        <h1>${escapeHTML(p.title)}</h1>
        <p>By ${escapeHTML(p.author)}</p>
        <p>ISBN: ${escapeHTML(p.isbn||"Not available")}</p>
        <p>★ ${p.rating}/5</p>
        <div class="product-price">${money(p.price)}</div>
        <p>${escapeHTML(p.description)}</p>
        <p>Available stock: ${p.stock}</p>
        <input id="detailQty" type="number" value="1" min="1" max="${p.stock}">
        <button class="primary-btn" onclick="addDetailToCart(${p.id})" ${p.stock<=0?"disabled":""}>Add to bag</button>
      </div>
    </div>`;
}

function addDetailToCart(id) {
  const qty=Math.max(1,Math.floor(Number(document.getElementById("detailQty").value)||1));
  addToCart(id,qty);
}

function addToCart(id,qty=1) {
  const p=db.products.find(x=>x.id===id);
  if(!p||p.stock<=0) return toast("Book unavailable.");

  const existing=db.cart.find(x=>x.id===id);
  if((existing?.qty||0)+qty>p.stock) return toast("Insufficient stock.");

  if(existing) existing.qty+=qty;
  else db.cart.push({id,qty});

  saveDB();
  toast("Book added to bag.");
}

function toggleWishlist(id) {
  if(db.wishlist.includes(id)) {
    db.wishlist=db.wishlist.filter(x=>x!==id);
    toast("Removed from wishlist.");
  } else {
    db.wishlist.push(id);
    toast("Added to wishlist.");
  }

  saveDB();
  renderHome();

  if(document.getElementById("shopPage").classList.contains("active")) renderShop();
  if(document.getElementById("wishlistPage").classList.contains("active")) renderWishlist();
}

function renderWishlist() {
  const items=db.products.filter(p=>db.wishlist.includes(p.id));
  document.getElementById("wishlistProducts").innerHTML=items.length?
    items.map(productCard).join():
    `<div class="empty-state"><h2>Your wishlist is empty.</h2></div>`;
}

/* CART */

function cartDetails() {
  const items=db.cart.map(i=>{
    const p=db.products.find(x=>x.id===i.id);
    return p?{...p,qty:i.qty}:null;
  }).filter(Boolean);

  const subtotal=items.reduce((s,p)=>s+p.price*p.qty,0);
  const shipping=subtotal===0||subtotal>=db.settings.freeShipping?0:49;

  return {items,subtotal,shipping,total:subtotal+shipping};
}

function changeQty(id,change) {
  const item=db.cart.find(x=>x.id===id);
  const p=db.products.find(x=>x.id===id);
  if(!item||!p) return;

  if(item.qty+change<=0) db.cart=db.cart.filter(x=>x.id!==id);
  else if(item.qty+change>p.stock) return toast("Stock limit reached.");
  else item.qty+=change;

  saveDB();
  renderCart();
}

function removeCart(id) {
  db.cart=db.cart.filter(x=>x.id!==id);
  saveDB();
  renderCart();
}

function renderCart() {
  const {items,subtotal,shipping,total}=cartDetails();
  const el=document.getElementById("cartContent");

  if(!items.length) {
    el.innerHTML=`<div class="empty-state"><h2>Your bag is empty.</h2><button class="primary-btn" onclick="showPage('shop')">Explore books</button></div>`;

    el.innerHTML=`<div class="empty-state"><h2>Your bag is empty.</h2><button class="primary-btn" onclick="showPage('shop')">Explore books</button></div>`;
    return;
  }

  el.innerHTML=`
  <div class="admin-card"><div class="admin-table-wrap">
  <table class="cart-table">
  <tr><th>BOOK</th><th>PRICE</th><th>QUANTITY</th><th>TOTAL</th><th></th></tr>
  ${items.map(p=>`
    <tr>
      <td><div class="cart-book-cell">${p.image ? `<img src="${escapeHTML(p.image)}" alt="" onerror="this.style.display='none'">` : ""}<span>${escapeHTML(p.title)}</span></div></td>
      <td>${money(p.price)}</td>
      <td><div class="quantity-control">
        <button onclick="changeQty(${p.id},-1)">−</button>
        <span>${p.qty}</span>
        <button onclick="changeQty(${p.id},1)">+</button>
      </div></td>
      <td>${money(p.price*p.qty)}</td>
      <td><button class="table-action danger" onclick="removeCart(${p.id})">Remove</button></td>
    </tr>`).join("")}
  </table></div></div>
  <div class="cart-summary">
    <h3>Order summary</h3>
    <div class="summary-row"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
    <div class="summary-row"><span>Shipping</span><strong>${shipping?money(shipping):"FREE"}</strong></div>
    <div class="summary-row"><strong>Total</strong><strong>${money(total)}</strong></div>
    <button class="primary-btn" onclick="showPage('checkout')">Proceed to checkout</button>
  </div>`;
}

/* COUPONS AND CHECKOUT */

function calculateDiscount(subtotal) {
  const c=db.coupons.find(x=>x.code===appliedCoupon&&x.active);
  if(!c||subtotal<c.min) return 0;
  return c.type==="percent"?Math.round(subtotal*c.value/100):c.value;
}

function applyCoupon() {
  const code=document.getElementById("couponInput").value.trim().toUpperCase();
  const c=db.coupons.find(x=>x.code===code&&x.active);
  const subtotal=cartDetails().subtotal;

  if(!c) return toast("Invalid coupon.");
  if(subtotal<c.min) return toast("Minimum order: "+money(c.min));

  appliedCoupon=code;
  renderCheckout();
  toast("Coupon applied.");
}

function renderCheckout() {
  const {items,subtotal,shipping}=cartDetails();
  const discount=calculateDiscount(subtotal);
  const customer=db.customers.find(c=>c.email===db.customerSession);

  if(!items.length) {
    document.getElementById("checkoutContent").innerHTML=
      `<div class="empty-state"><h2>Your bag is empty.</h2></div>`;
    return;
  }

  document.getElementById("checkoutContent").innerHTML=`
  <form class="form-layout" onsubmit="placeOrder(event)">
    <div>
      <div class="form-card">
        <h3>Delivery details</h3>
        <label>Full name</label><input name="name" required value="${escapeHTML(customer?.name||"")}">
        <label>Email</label><input name="email" type="email" required value="${escapeHTML(customer?.email||"")}">
        <label>Mobile</label><input name="phone" pattern="[0-9]{10}" required>
        <label>Address</label><textarea name="address" required></textarea>
        <label>City</label><input name="city" required>
        <label>State</label><input name="state" required>
        <label>PIN code</label><input name="pin" pattern="[0-9]{6}" required>
      </div>
      <div class="form-card">
        <h3>Payment method</h3>
        <label class="payment-option"><input type="radio" name="payment" value="UPI" checked> UPI (Demo)</label>
        <label class="payment-option"><input type="radio" name="payment" value="Card"> Card (Demo)</label>
        <label class="payment-option"><input type="radio" name="payment" value="COD"> Cash on Delivery</label>
        <p class="muted">No real payment is collected.</p>
      </div>
    </div>
    <div class="form-card">
      <h3>Summary</h3>
      ${items.map(p=>`<div class="summary-row checkout-book-row"><span>${p.image ? `<img src="${escapeHTML(p.image)}" alt="" onerror="this.style.display='none'">` : ""}${escapeHTML(p.title)} × ${p.qty}</span><strong>${money(p.price*p.qty)}</strong></div>`).join("")}
      <hr>
      <div class="summary-row"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
      <div class="summary-row"><span>Shipping</span><strong>${money(shipping)}</strong></div>
      <div class="summary-row"><span>Discount</span><strong>-${money(discount)}</strong></div>
      <div class="summary-row"><strong>Total</strong><strong>${money(subtotal+shipping-discount)}</strong></div>
      <label>Coupon code</label>
      <input id="couponInput" value="${escapeHTML(appliedCoupon||"")}" placeholder="Enter coupon">
      <button type="button" class="admin-btn" onclick="applyCoupon()">Apply</button>
      <button class="primary-btn full-btn">Place fictional order</button>
    </div>
  </form>`;
}

function placeOrder(event) {
  event.preventDefault();

  const data=Object.fromEntries(new FormData(event.target).entries());
  const {items,subtotal,shipping}=cartDetails();
  const discount=calculateDiscount(subtotal);

  if(!items.length) return toast("Cart is empty.");

  for(const item of items) {
    const p=db.products.find(x=>x.id===item.id);
    if(!p||p.stock<item.qty) return toast("Stock changed. Please check your cart.");
  }

  const order={
    id:"BN"+Date.now().toString().slice(-8),
    customer:data.name,
    email:data.email.toLowerCase(),
    phone:data.phone,
    address:[data.address,data.city,data.state,data.pin].join(", "),
    items:items.map(p=>({id:p.id,title:p.title,author:p.author,isbn:p.isbn,image:p.image||"",price:p.price,qty:p.qty})),
    subtotal,discount,shipping,
    total:subtotal+shipping-discount,
    payment:data.payment,
    paymentStatus:data.payment==="COD"?"Pending":"Paid (Demo)",
    status:"Processing",
    date:today(),
    coupon:appliedCoupon||"",
    returned:false
  };

  items.forEach(i=>{
    db.products.find(p=>p.id===i.id).stock-=i.qty;
  });

  db.orders.unshift(order);

  let customer=db.customers.find(c=>c.email===order.email);
  if(!customer) {
    customer={name:data.name,email:order.email,phone:data.phone,password:"",joined:today()};
    db.customers.push(customer);
  }

  db.customerSession=order.email;
  db.cart=[];
  appliedCoupon=null;
  db.notifications.unshift("New order "+order.id+" received.");

  saveDB();
  renderHome();

  showModal(`
    <div style="text-align:center">
      <h2 style="color:var(--green)">Order confirmed!</h2>
      <p>Your fictional order was created successfully.</p>
      <h3>${escapeHTML(order.id)}</h3>
      <p>Total: ${money(order.total)}</p>
      <button class="primary-btn" onclick="closeModal();showPage('orders')">Track order</button>
    </div>`);
}

/* CUSTOMER ACCOUNT */

function renderAccount() {
  const user=db.customers.find(c=>c.email===db.customerSession);
  const el=document.getElementById("accountContent");

  if(user) {
    el.innerHTML=`
    <div class="form-card" style="max-width:600px;margin:auto">
      <h2>Welcome, ${escapeHTML(user.name)}</h2>
      <p>${escapeHTML(user.email)}</p>
      <button class="primary-btn" onclick="showPage('orders')">My orders</button>
      <button class="add-btn" onclick="customerLogout()">Sign out</button>
    </div>`;
    return;
  }

  el.innerHTML=`
  <div class="form-card" style="max-width:450px;margin:auto">
    <h2>Customer sign in</h2>
    <form onsubmit="customerLogin(event)">
      <label>Email</label><input name="email" type="email" required>
      <label>Password</label><input name="password" type="password" required>
      <button class="primary-btn full-btn">Sign in</button>
    </form>
    <hr style="margin:25px 0">
    <h3>Create account</h3>
    <form onsubmit="customerRegister(event)">
      <label>Name</label><input name="name" required>
      <label>Email</label><input name="email" type="email" required>
      <label>Phone</label><input name="phone" pattern="[0-9]{10}" required>
      <label>Password</label><input name="password" type="password" minlength="4" required>
      <button class="primary-btn full-btn">Register</button>
    </form>
  </div>`;
}

function customerLogin(event) {
  event.preventDefault();
  const d=Object.fromEntries(new FormData(event.target).entries());
  const c=db.customers.find(x=>x.email===d.email.toLowerCase()&&x.password===d.password);
  if(!c) return toast("Invalid customer login.");
  db.customerSession=c.email;
  saveDB();
  renderAccount();
  toast("Welcome back.");
}

function customerRegister(event) {
  event.preventDefault();
  const d=Object.fromEntries(new FormData(event.target).entries());
  if(db.customers.some(c=>c.email===d.email.toLowerCase())) return toast("Email already registered.");

  db.customers.push({...d,email:d.email.toLowerCase(),joined:today()});
  db.customerSession=d.email.toLowerCase();
  saveDB();
  renderAccount();
  toast("Account created.");
}

function customerLogout() {
  db.customerSession=null;
  saveDB();
  renderAccount();
}

function renderOrders() {
  const orders=db.customerSession?
    db.orders.filter(o=>o.email===db.customerSession):[];

  document.getElementById("ordersContent").innerHTML=orders.length?
    orders.map(o=>`
    <div class="admin-card">
      <strong>${escapeHTML(o.id)}</strong>
      <span class="status ${statusClass(o.status)}">${escapeHTML(o.status)}</span>
      <p>${escapeHTML(o.date)}</p>
      ${o.items.map(i=>`<p class="order-book-line">${i.image ? `<img src="${escapeHTML(i.image)}" alt="" onerror="this.style.display='none'">` : ""}${escapeHTML(i.title)} × ${i.qty}</p>`).join("")}
      <strong>${money(o.total)}</strong>
      <p>${escapeHTML(o.paymentStatus)}</p>
      ${o.status==="Delivered"?`<button class="admin-btn secondary" onclick="requestReturn('${o.id}')">Request return</button>`:""}
    </div>`).join(""):
    `<div class="empty-state"><h2>No orders found.</h2><button class="primary-btn" onclick="showPage('shop')">Shop now</button></div>`;
}

function statusClass(s) {
  return s==="Delivered"?"":s==="Shipped"?"shipped":
    s==="Cancelled"||s==="Returned"?"cancelled":
    s==="Pending"||s==="Processing"?"pending":"";
}

function requestReturn(id) {
  const o=db.orders.find(x=>x.id===id);
  if(!o||o.status!=="Delivered") return toast("Only delivered orders can be returned.");
  if(db.returns.some(r=>r.orderId===id)) return toast("Return already requested.");

  db.returns.unshift({
    id:"RET"+Date.now().toString().slice(-6),
    orderId:id,customer:o.customer,
    status:"Requested",date:today()
  });

  saveDB();
  renderOrders();
  toast("Return request submitted.");
}

function renderReturns() {
  document.getElementById("returnsContent").innerHTML=`
  <div class="admin-card">
    <h3>Return policy</h3>
    <p>Returns can be requested for delivered demo orders.</p>
    <button class="primary-btn" onclick="showPage('orders')">View orders</button>
  </div>
  ${db.returns.filter(r=>db.orders.find(o=>o.id===r.orderId&&o.email===db.customerSession)).map(r=>
    `<div class="admin-card">${escapeHTML(r.orderId)} · ${escapeHTML(r.status)}</div>`).join("")}`;
}

function subscribe(event) {
  event.preventDefault();
  const email=document.getElementById("newsletterEmail").value.trim().toLowerCase();
  if(!db.subscribers.includes(email)) db.subscribers.push(email);
  saveDB();
  document.getElementById("newsletterMessage").textContent="Thank you for subscribing!";
  event.target.reset();
}

/* ADMIN AUTHENTICATION */

document.getElementById("adminLoginForm").addEventListener("submit",event=>{
  event.preventDefault();
  const email=document.getElementById("adminEmail").value;
  const password=document.getElementById("adminPassword").value;

  if(email==="admin@booknest.demo"&&password==="admin123") {
    db.adminSession=true;
    saveDB();
    openAdmin();
  } else {
    document.getElementById("loginError").textContent="Invalid credentials.";
  }
});

function openAdmin() {
  if(!db.adminSession) return showPage("adminLogin");

  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.getElementById("storefront").classList.add("hidden");
  document.getElementById("storeFooter").classList.add("hidden");
  document.getElementById("adminPanel").classList.remove("hidden");
  document.getElementById("adminDate").textContent=new Date().toLocaleDateString("en-IN");

  adminTab("dashboard");
}

function adminLogout() {
  db.adminSession=false;
  saveDB();
  showPage("home");
}

function adminTab(tab,button) {
  if(!db.adminSession) return showPage("adminLogin");

  activeAdminTab=tab;
  document.querySelectorAll(".side-link").forEach(b=>b.classList.remove("active"));
  if(button) button.classList.add("active");

  renderAdminContent();
  document.querySelector(".admin-sidebar").classList.remove("mobile-open");
}

function renderAdminContent() {
  const view=adminViews[activeAdminTab]||adminViews.dashboard;
  document.getElementById("adminContent").innerHTML=view();
}

function toggleAdminSidebar() {
  document.querySelector(".admin-sidebar").classList.toggle("mobile-open");
}

/* LIVE BUSINESS CALCULATIONS */

function validOrders() {
  return db.orders.filter(o=>o.status!=="Cancelled"&&o.paymentStatus!=="Refunded");
}

function revenue() {
  return validOrders().reduce((s,o)=>s+o.total,0);
}

function totalItemsSold() {

  return validOrders().reduce((s,o)=>s+o.items.reduce((n,i)=>n+i.qty,0),0);
}

function expensesTotal() {
  return db.expenses.reduce((s,e)=>s+Number(e.amount),0);
}

function productCost() {
  return validOrders().reduce((sum,o)=>sum+o.items.reduce((s,i)=>{
    const p=db.products.find(x=>x.id===i.id);
    return s+(p?.cost||Math.round(i.price*.55))*i.qty;
  },0),0);
}

function profit() {
  return revenue()-productCost()-expensesTotal();
}

function stat(label,value,note="Updated from demo records") {
  return `<div class="stat-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
}

function chartMarkup() {
  const months=[];
  for(let i=5;i>=0;i--) {
    const d=new Date();
    d.setDate(1);
    d.setMonth(d.getMonth()-i);
    const key=d.toISOString().slice(0,7);
    const value=validOrders().filter(o=>o.date.startsWith(key)).reduce((s,o)=>s+o.total,0);
    months.push({label:d.toLocaleDateString("en-IN",{month:"short"}),value});
  }

  const max=Math.max(1,...months.map(m=>m.value));

  return `<div class="bar-chart">${months.map(m=>`
    <div class="bar-item">
      <span class="bar-value">${money(m.value)}</span>
      <div class="bar" style="height:${Math.max(2,m.value/max*100)}%"></div>
      <span class="bar-label">${m.label}</span>
    </div>`).join("")}</div>`;
}

function orderTable(orders) {
  return orders.map(o=>`
    <tr>
      <td>${escapeHTML(o.id)}</td>
      <td>${escapeHTML(o.customer)}</td>
      <td>${money(o.total)}</td>
      <td>${escapeHTML(o.payment)}</td>
      <td><span class="status ${statusClass(o.status)}">${escapeHTML(o.status)}</span></td>
      <td>${escapeHTML(o.date)}</td>
      <td><button class="table-action" onclick="editOrder('${o.id}')">Manage</button></td>
    </tr>`).join("")||"<tr><td colspan='7'>No orders yet.</td></tr>";
}

/* ADMIN DASHBOARD AND MODULES */

const adminViews={

dashboard() {
  return `
  <div class="admin-heading"><div><h1>Business overview</h1><p>Live summary of your BOOKNEST store.</p></div><button class="admin-btn" onclick="exportOrders()">Export orders</button></div>
  <div class="stat-grid">
    ${stat("TOTAL REVENUE",money(revenue()))}
    ${stat("TOTAL ORDERS",db.orders.length)}
    ${stat("BOOKS SOLD",totalItemsSold())}
    ${stat("CUSTOMERS",db.customers.length)}
    ${stat("ESTIMATED PROFIT",money(profit()))}
    ${stat("PENDING ORDERS",db.orders.filter(o=>["Pending","Processing"].includes(o.status)).length)}
    ${stat("INVENTORY UNITS",db.products.reduce((s,p)=>s+p.stock,0))}
    ${stat("RETURN REQUESTS",db.returns.length)}
  </div>
  <div class="admin-grid">
    <div class="admin-card"><h3>Monthly revenue</h3>${chartMarkup()}</div>
    <div class="admin-card"><h3>Store health</h3>
      <div class="summary-row"><span>Products</span><strong>${db.products.length}</strong></div>
      <div class="summary-row"><span>Low stock</span><strong>${db.products.filter(p=>p.stock>0&&p.stock<=10).length}</strong></div>
      <div class="summary-row"><span>Out of stock</span><strong>${db.products.filter(p=>p.stock===0).length}</strong></div>
      <div class="summary-row"><span>Subscribers</span><strong>${db.subscribers.length}</strong></div>
    </div>
  </div>
  <div class="admin-card"><h3>Recent orders</h3><div class="admin-table-wrap"><table class="admin-table">
    <tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Date</th><th>Action</th></tr>
    ${orderTable(db.orders.slice(0,8))}
  </table></div></div>`;
},

analytics() {
  const categories={};
  validOrders().forEach(o=>o.items.forEach(i=>{
    const p=db.products.find(x=>x.id===i.id);
    const cat=p?.category||"Other";
    categories[cat]=(categories[cat]||0)+i.price*i.qty;
  }));

  return `
  <div class="admin-heading"><div><h1>Sales analytics</h1><p>Performance calculated from recorded orders.</p></div></div>
  <div class="stat-grid">
    ${stat("REVENUE",money(revenue()))}
    ${stat("AVERAGE ORDER",money(db.orders.length?revenue()/db.orders.length:0))}
    ${stat("BOOKS SOLD",totalItemsSold())}
    ${stat("CANCELLED ORDERS",db.orders.filter(o=>o.status==="Cancelled").length)}
  </div>
  <div class="admin-grid">
    <div class="admin-card"><h3>Monthly revenue</h3>${chartMarkup()}</div>
    <div class="admin-card"><h3>Revenue by category</h3>
      ${Object.entries(categories).map(([k,v])=>`<div class="summary-row"><span>${escapeHTML(k)}</span><strong>${money(v)}</strong></div>`).join("")||"No sales yet"}
    </div>
  </div>
  <div class="admin-card"><h3>Best selling products</h3>
    ${db.products.map(p=>({...p,sold:validOrders().reduce((s,o)=>s+o.items.filter(i=>i.id===p.id).reduce((n,i)=>n+i.qty,0),0)})).sort((a,b)=>b.sold-a.sold).slice(0,8).map(p=>`<div class="summary-row"><span>${escapeHTML(p.title)}</span><strong>${p.sold} sold</strong></div>`).join("")}
  </div>`;
},

orders() {
  return `
  <div class="admin-heading"><div><h1>Orders</h1><p>Manage all customer orders.</p></div><button class="admin-btn" onclick="exportOrders()">Export CSV</button></div>
  <div class="admin-card">
    <div class="shop-toolbar"><input id="orderSearch" placeholder="Search customer or order..." oninput="filterOrderTable()">
    <select id="orderStatusFilter" onchange="filterOrderTable()"><option>All</option>${["Processing","Pending","Shipped","Delivered","Cancelled","Returned"].map(x=>`<option>${x}</option>`).join("")}</select></div>
    <div class="admin-table-wrap"><table class="admin-table" id="ordersTable">
      <tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Date</th><th>Action</th></tr>
      <tbody>${orderTable(db.orders)}</tbody>
    </table></div>
  </div>`;
},

products() {
  return `
  <div class="admin-heading"><div><h1>Products</h1><p>Manage catalogue and book details.</p></div><button class="admin-btn" onclick="productModal()">+ Add book</button></div>
  <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table">
    <tr><th>Book</th><th>ISBN</th><th>Price</th><th>Stock</th><th>Actions</th></tr>
    ${db.products.map(p=>`<tr><td><div class="cart-book-cell">${p.image ? `<img src="${escapeHTML(p.image)}" alt="" onerror="this.style.display='none'">` : ""}<span>${escapeHTML(p.title)}</span></div></td><td>${escapeHTML(p.isbn||"-")}</td><td>${money(p.price)}</td><td>${p.stock}</td><td>${p.image ? "" : `<button class="table-action" onclick="refreshBookCover(${p.id}, true)">Find cover</button>`} <button class="table-action" onclick="productModal(${p.id})">Edit</button> <button class="table-action danger" onclick="deleteProduct(${p.id})">Delete</button></td></tr>`).join("")}
  </table></div></div>`;
},

inventory() {
  return `
  <div class="admin-heading"><div><h1>Inventory</h1><p>Stock levels update automatically after checkout.</p></div></div>
  <div class="stat-grid">
    ${stat("PRODUCTS",db.products.length)}
    ${stat("TOTAL UNITS",db.products.reduce((s,p)=>s+p.stock,0))}
    ${stat("LOW STOCK",db.products.filter(p=>p.stock>0&&p.stock<=10).length)}
    ${stat("OUT OF STOCK",db.products.filter(p=>p.stock===0).length)}
  </div>
  <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table">
    <tr><th>Book</th><th>Stock</th><th>Status</th><th>Action</th></tr>
    ${db.products.map(p=>`<tr><td><div class="cart-book-cell">${p.image ? `<img src="${escapeHTML(p.image)}" alt="" onerror="this.style.display='none'">` : ""}<span>${escapeHTML(p.title)}</span></div></td><td>${p.stock}</td><td><span class="status ${p.stock===0?"cancelled":p.stock<=10?"pending":""}">${p.stock===0?"Out of stock":p.stock<=10?"Low stock":"Available"}</span></td><td><button class="table-action" onclick="updateStock(${p.id})">Adjust</button> ${p.image ? "" : `<button class="table-action" onclick="refreshBookCover(${p.id}, true)">Find cover</button>`}</td></tr>`).join("")}
  </table></div></div>`;
},

customers() {
  return `
  <div class="admin-heading"><div><h1>Customers</h1><p>Registered customer directory.</p></div><button class="admin-btn" onclick="exportCustomers()">Export</button></div>
  <div class="stat-grid">${stat("TOTAL CUSTOMERS",db.customers.length)}${stat("NEWSLETTER",db.subscribers.length)}${stat("ORDERS",db.orders.length)}${stat("REPEAT CUSTOMERS",db.customers.filter(c=>db.orders.filter(o=>o.email===c.email).length>1).length)}</div>
  <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table">
    <tr><th>Name</th><th>Email</th><th>Phone</th><th>Orders</th><th>Spent</th></tr>
    ${db.customers.map(c=>{const orders=db.orders.filter(o=>o.email===c.email);return `<tr><td>${escapeHTML(c.name)}</td><td>${escapeHTML(c.email)}</td><td>${escapeHTML(c.phone||"-")}</td><td>${orders.length}</td><td>${money(orders.reduce((s,o)=>s+o.total,0))}</td></tr>`}).join("")}
  </table></div></div>`;
},

returns() {
  return `<div class="admin-heading"><div><h1>Returns</h1><p>Manage return requests and refunds.</p></div></div>
  <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table">
    <tr><th>Return ID</th><th>Order</th><th>Customer</th><th>Status</th><th>Action</th></tr>
    ${db.returns.map(r=>`<tr><td>${escapeHTML(r.id)}</td><td>${escapeHTML(r.orderId)}</td><td>${escapeHTML(r.customer)}</td><td>${escapeHTML(r.status)}</td><td><button class="table-action" onclick="manageReturn('${r.id}')">Manage</button></td></tr>`).join("")||"<tr><td colspan='5'>No returns.</td></tr>"}
  </table></div></div>`;
},

shipping() {
  return `<div class="admin-heading"><div><h1>Shipping</h1><p>Simulated delivery management.</p></div></div>
  <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table">
    <tr><th>Order</th><th>Customer</th><th>Address</th><th>Status</th><th>Action</th></tr>
    ${db.orders.map(o=>`<tr><td>${escapeHTML(o.id)}</td><td>${escapeHTML(o.customer)}</td><td>${escapeHTML(o.address)}</td><td>${escapeHTML(o.status)}</td><td><button class="table-action" onclick="editOrder('${o.id}')">Update</button></td></tr>`).join("")}
  </table></div></div>`;
},

finance() {
  return `<div class="admin-heading"><div><h1>Finance</h1><p>Illustrative profit and loss calculations.</p></div><button class="admin-btn" onclick="expenseModal()">+ Add expense</button></div>
  <div class="stat-grid">
    ${stat("REVENUE",money(revenue()))}
    ${stat("PRODUCT COST",money(productCost()))}
    ${stat("EXPENSES",money(expensesTotal()))}
    ${stat("ESTIMATED PROFIT",money(profit()))}
  </div>
  <div class="admin-card"><h3>Profit & loss</h3>
    <div class="summary-row"><span>Revenue</span><strong>${money(revenue())}</strong></div>
    <div class="summary-row"><span>Product costs</span><strong>-${money(productCost())}</strong></div>
    <div class="summary-row"><span>Operating expenses</span><strong>-${money(expensesTotal())}</strong></div>
    <div class="summary-row"><span>Illustrative GST component</span><strong>${money(revenue()*db.settings.gst/(100+db.settings.gst))}</strong></div>
    <div class="summary-row"><strong>Estimated profit</strong><strong>${money(profit())}</strong></div>
  </div>
  <div class="admin-card"><h3>Expenses</h3>
    ${db.expenses.map(e=>`<div class="summary-row"><span>${escapeHTML(e.name)} · ${escapeHTML(e.date)}</span><strong>${money(e.amount)} <button class="table-action danger" onclick="deleteExpense(${e.id})">×</button></strong></div>`).join("")}
  </div>
  <p class="muted">Illustrative calculations only, not statutory accounts or GST filings.</p>`;
},

marketing() {
  return `<div class="admin-heading"><div><h1>Marketing</h1><p>Manage fictional discount coupons.</p></div><button class="admin-btn" onclick="couponModal()">+ Create coupon</button></div>
  <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table">
    <tr><th>Code</th><th>Type</th><th>Value</th><th>Minimum</th><th>Status</th><th>Action</th></tr>
    ${db.coupons.map(c=>`<tr><td>${escapeHTML(c.code)}</td><td>${c.type}</td><td>${c.value}${c.type==="percent"?"%":"₹"}</td><td>${money(c.min)}</td><td>${c.active?"Active":"Inactive"}</td><td><button class="table-action" onclick="toggleCoupon('${c.code}')">Toggle</button></td></tr>`).join("")}
  </table></div></div>
  <div class="admin-card"><h3>Newsletter</h3><p>${db.subscribers.length} subscribers</p><button class="admin-btn secondary" onclick="exportSubscribers()">Export subscribers</button></div>`;
},

suppliers() {
  return `<div class="admin-heading"><div><h1>Suppliers</h1><p>Manage fictional suppliers.</p></div><button class="admin-btn" onclick="supplierModal()">+ Add supplier</button></div>
  <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table">
    <tr><th>Name</th><th>Phone</th><th>Email</th><th>Action</th></tr>
    ${db.suppliers.map(s=>`<tr><td>${escapeHTML(s.name)}</td><td>${escapeHTML(s.phone)}</td><td>${escapeHTML(s.email)}</td><td><button class="table-action danger" onclick="deleteSupplier(${s.id})">Remove</button></td></tr>`).join("")}
  </table></div></div>`;
},

employees() {
  return `<div class="admin-heading"><div><h1>Employees</h1><p>Fictional staff directory.</p></div><button class="admin-btn" onclick="employeeModal()">+ Add employee</button></div>
  <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table">
    <tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr>
    ${db.employees.map(e=>`<tr><td>${escapeHTML(e.name)}</td><td>${escapeHTML(e.email)}</td><td>${escapeHTML(e.role)}</td><td><button class="table-action danger" onclick="deleteEmployee(${e.id})">Remove</button></td></tr>`).join("")}
  </table></div></div>
  <p class="muted">Employee records do not create separate login permissions in this local demo.</p>`;
},

content() {
  return `<div class="admin-heading"><div><h1>Website settings</h1><p>Manage store configuration.</p></div></div>
  <div class="admin-card"><form class="admin-form" onsubmit="saveSettings(event)">
    <div><label>Store name</label><input name="storeName" value="${escapeHTML(db.settings.storeName)}"></div>
    <div><label>Free shipping threshold</label><input name="freeShipping" type="number" min="0" value="${db.settings.freeShipping}"></div>
    <div><label>Demo GST percentage</label><input name="gst" type="number" min="0" max="100" value="${db.settings.gst}"></div>
    <div class="wide"><button class="admin-btn">Save settings</button></div>
  </form></div>`;
},

reports() {
  return `<div class="admin-heading"><div><h1>Reports</h1><p>Download business data.</p></div></div>
  <div class="admin-grid">
    <div class="admin-card"><h3>Sales report</h3><button class="admin-btn" onclick="exportOrders()">Download CSV</button></div>
    <div class="admin-card"><h3>Inventory report</h3><button class="admin-btn" onclick="exportInventory()">Download CSV</button></div>
    <div class="admin-card"><h3>Customer report</h3><button class="admin-btn" onclick="exportCustomers()">Download CSV</button></div>
    <div class="admin-card"><h3>Financial report</h3><button class="admin-btn" onclick="exportReport()">Download CSV</button></div>
  </div>`;
},

settings() {
  return `<div class="admin-heading"><div><h1>System settings</h1><p>Local demo database controls.</p></div></div>
  <div class="admin-card"><p>Application: BOOKNEST</p><p>Version: 2.0</p><p>Storage: LocalStorage</p><p>Mode: Fictional demonstration</p></div>
  <div class="admin-card"><h3>Backup and restore</h3><button class="admin-btn secondary" onclick="backupData()">Download backup</button> <button class="admin-btn" style="background:#a64c4c" onclick="resetDatabase()">Reset demo database</button></div>`;
}

};

/* ADMIN ORDER ACTIONS */

function editOrder(id) {
  const o=db.orders.find(x=>x.id===id);
  if(!o) return;

  showModal(`
    <h2>Manage ${escapeHTML(id)}</h2>
    <p>${escapeHTML(o.customer)} · ${money(o.total)}</p>
    <label>Status</label>
    <select id="newOrderStatus">${["Pending","Processing","Shipped","Delivered","Cancelled","Returned"].map(s=>`<option ${o.status===s?"selected":""}>${s}</option>`).join("")}</select>
    <label>Payment status</label>
    <select id="newPaymentStatus">${["Pending","Paid (Demo)","Refunded"].map(s=>`<option ${o.paymentStatus===s?"selected":""}>${s}</option>`).join("")}</select>
    <button class="primary-btn full-btn" onclick="saveOrder('${id}')">Save changes</button>`);
}

function saveOrder(id) {
  const o=db.orders.find(x=>x.id===id);
  if(!o) return;
  const next=document.getElementById("newOrderStatus").value;
  const payment=document.getElementById("newPaymentStatus").value;

  if(next==="Cancelled"&&o.status!=="Cancelled") {
    o.items.forEach(i=>{
      const p=db.products.find(x=>x.id===i.id);
      if(p) p.stock+=i.qty;
    });
  }

  if(o.status==="Cancelled"&&next!=="Cancelled") {
    for(const i of o.items) {
      const p=db.products.find(x=>x.id===i.id);
      if(!p||p.stock<i.qty) return toast("Insufficient stock to restore this order.");
    }
    o.items.forEach(i=>db.products.find(x=>x.id===i.id).stock-=i.qty);
  }

  o.status=next;
  o.paymentStatus=payment;
  db.notifications.unshift("Order "+id+" updated.");
  closeModal();
  saveDB();
  toast("Order updated.");
}

function filterOrderTable() {
  const search=(document.getElementById("orderSearch").value||"").toLowerCase();
  const status=document.getElementById("orderStatusFilter").value;
  const items=db.orders.filter(o=>
    (o.id+" "+o.customer+" "+o.email).toLowerCase().includes(search)&&
    (status==="All"||o.status===status)
  );
  document.querySelector("#ordersTable tbody").innerHTML=orderTable(items);
}

/* PRODUCT MANAGEMENT */

function productModal(id=null) {
  const p=id?db.products.find(x=>x.id===id):null;
  showModal(`
  <h2>${p?"Edit book":"Add book"}</h2>
  <form class="admin-form" onsubmit="saveProduct(event,${id??"null"})">
    <div class="wide"><label>Title</label><input name="title" required value="${escapeHTML(p?.title||"")}"></div>
    <div><label>Author</label><input name="author" required value="${escapeHTML(p?.author||"")}"></div>
    <div><label>Category</label><select name="category">${["Fiction","Self Help","Business","Romance","Mythology","Preloved"].map(x=>`<option ${p?.category===x?"selected":""}>${x}</option>`).join("")}</select></div>
    <div><label>Price</label><input name="price" type="number" min="1" required value="${p?.price||""}"></div>
    <div><label>MRP</label><input name="mrp" type="number" min="1" required value="${p?.mrp||""}"></div>
    <div><label>Stock</label><input name="stock" type="number" min="0" required value="${p?.stock??0}"></div>
    <div><label>Cost</label><input name="cost" type="number" min="0" value="${p?.cost??0}"></div>
    <div><label>ISBN</label><input name="isbn" value="${escapeHTML(p?.isbn||"")}"></div>
    <div><label>Cover image URL</label><input name="image" value="${escapeHTML(p?.image||"")}"></div>
    <div><label>Tag</label><input name="tag" value="${escapeHTML(p?.tag||"")}"></div>
    <div class="wide"><label>Description</label><textarea name="description">${escapeHTML(p?.description||"")}</textarea></div>
    <div class="wide"><button class="primary-btn full-btn">Save product</button></div>
  </form>`);
}

function saveProduct(event,id) {
  event.preventDefault();
  const d=Object.fromEntries(new FormData(event.target).entries());

  const previous = id ? db.products.find(x => x.id === id) : null;
  const identityChanged = previous && (
    String(previous.isbn || "") !== String(d.isbn || "") ||
    previous.title !== d.title || previous.author !== d.author
  );
  if(identityChanged) d.image = "";
  d.image = String(d.image || "").trim();

  const p={
    id:id??Math.max(0,...db.products.map(x=>x.id))+1,
    ...d,
    price:Number(d.price),
    mrp:Number(d.mrp),
    stock:Number(d.stock),
    cost:Number(d.cost),
    rating:previous?.rating || 4.5,
    coverStatus:d.image ? "found" : "pending"
  };

  if(id) {
    const index=db.products.findIndex(x=>x.id===id);
    if(index<0) return toast("Product not found.");
    db.products[index]={...db.products[index],...p};
  } else db.products.unshift(p);

  closeModal();
  saveDB();
  if(!p.image) refreshBookCover(p.id, true);
  toast("Product saved.");
}

function deleteProduct(id) {
  if(!confirm("Delete this book?")) return;
  db.products=db.products.filter(p=>p.id!==id);
  db.cart=db.cart.filter(p=>p.id!==id);
  db.wishlist=db.wishlist.filter(x=>x!==id);
  saveDB();
  toast("Product removed.");
}

function updateStock(id) {
  const p=db.products.find(x=>x.id===id);
  if(!p) return;
  const n=prompt("Enter new stock quantity",p.stock);
  if(n===null) return;
  if(!/^\d+$/.test(n)) return toast("Enter a valid quantity.");
  p.stock=Number(n);
  saveDB();
  toast("Inventory updated.");
}

/* RETURNS */

function manageReturn(id) {
  const r=db.returns.find(x=>x.id===id);
  if(!r) return;
  showModal(`
    <h2>Manage return</h2>
    <p>${escapeHTML(r.orderId)}</p>
    <select id="returnStatus">${["Requested","Approved","Rejected","Refunded","Completed"].map(s=>`<option ${r.status===s?"selected":""}>${s}</option>`).join("")}</select>
    <button class="primary-btn full-btn" onclick="saveReturn('${id}')">Save return</button>`);
}

function saveReturn(id) {
  const r=db.returns.find(x=>x.id===id);
  if(!r) return;
  const next=document.getElementById("returnStatus").value;
  r.status=next;
  const o=db.orders.find(x=>x.id===r.orderId);

  if(o&&next==="Refunded") {
    o.paymentStatus="Refunded";
    o.status="Returned";
  } else if(o&&next==="Completed") {
    o.status="Returned";
  }

  closeModal();
  saveDB();
  toast("Return updated.");
}

/* FINANCE, MARKETING, SUPPLIERS, EMPLOYEES */

function expenseModal() {
  showModal(`<h2>Add expense</h2>
  <form onsubmit="saveExpense(event)">
    <label>Description</label><input name="name" required>
    <label>Amount</label><input name="amount" type="number" min="1" required>
    <label>Date</label><input name="date" type="date" value="${today()}" required>
    <button class="primary-btn full-btn">Save</button>
  </form>`);
}

function saveExpense(event) {
  event.preventDefault();
  const d=Object.fromEntries(new FormData(event.target).entries());
  db.expenses.unshift({id:Date.now(),...d,amount:Number(d.amount)});
  closeModal();saveDB();toast("Expense added.");
}

function deleteExpense(id) {
  if(!confirm("Delete expense?")) return;
  db.expenses=db.expenses.filter(x=>x.id!==id);
  saveDB();
}

function couponModal() {
  showModal(`<h2>Create coupon</h2><form onsubmit="saveCoupon(event)">
    <label>Code</label><input name="code" required>
    <label>Type</label><select name="type"><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select>
    <label>Value</label><input name="value" type="number" min="1" required>
    <label>Minimum order</label><input name="min" type="number" min="0" value="0">
    <button class="primary-btn full-btn">Create</button></form>`);
}

function saveCoupon(event) {
  event.preventDefault();
  const d=Object.fromEntries(new FormData(event.target).entries());
  const code=d.code.trim().toUpperCase();
  if(db.coupons.some(x=>x.code===code)) return toast("Coupon already exists.");
  db.coupons.push({code,type:d.type,value:Number(d.value),min:Number(d.min),active:true});
  closeModal();saveDB();toast("Coupon created.");
}

function toggleCoupon(code) {
  const c=db.coupons.find(x=>x.code===code);
  if(c) {c.active=!c.active;saveDB();}
}

function supplierModal() {
  showModal(`<h2>Add supplier</h2><form onsubmit="saveSupplier(event)">
    <label>Name</label><input name="name" required>
    <label>Phone</label><input name="phone">
    <label>Email</label><input name="email" type="email">
    <button class="primary-btn full-btn">Save supplier</button></form>`);
}

function saveSupplier(event) {
  event.preventDefault();
  db.suppliers.push({id:Date.now(),...Object.fromEntries(new FormData(event.target).entries())});
  closeModal();saveDB();
}

function deleteSupplier(id) {
  if(!confirm("Delete supplier?")) return;
  db.suppliers=db.suppliers.filter(x=>x.id!==id);saveDB();
}

function employeeModal() {
  showModal(`<h2>Add employee</h2><form onsubmit="saveEmployee(event)">
    <label>Name</label><input name="name" required>
    <label>Email</label><input name="email" type="email" required>
    <label>Role</label><select name="role">${["Order Manager","Inventory Manager","Marketing Manager","Accountant","Customer Support"].map(x=>`<option>${x}</option>`).join("")}</select>
    <button class="primary-btn full-btn">Save employee</button></form>`);
}

function saveEmployee(event) {
  event.preventDefault();
  db.employees.push({id:Date.now(),...Object.fromEntries(new FormData(event.target).entries())});
  closeModal();saveDB();
}

function deleteEmployee(id) {
  if(!confirm("Remove employee?")) return;
  db.employees=db.employees.filter(x=>x.id!==id);saveDB();
}

function saveSettings(event) {
  event.preventDefault();
  const d=Object.fromEntries(new FormData(event.target).entries());
  db.settings={storeName:d.storeName,freeShipping:Number(d.freeShipping),gst:Number(d.gst)};
  saveDB();toast("Settings saved.");
}

/* MODALS */

function showModal(html) {
  document.getElementById("modalContent").innerHTML=html;
  document.getElementById("modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}

/* CSV REPORTS */

function csvDownload(filename,rows) {
  const csv=rows.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=filename;a.click();
  URL.revokeObjectURL(url);
}

function exportOrders() {
  csvDownload("booknest-orders.csv",[
    ["ID","Customer","Email","Amount","Payment","Payment Status","Status","Date"],
    ...db.orders.map(o=>[o.id,o.customer,o.email,o.total,o.payment,o.paymentStatus,o.status,o.date])
  ]);
}

function exportInventory() {
  csvDownload("booknest-inventory.csv",[
    ["ID","Title","ISBN","Price","Stock"],
    ...db.products.map(p=>[p.id,p.title,p.isbn,p.price,p.stock])
  ]);
}

function exportCustomers() {
  csvDownload("booknest-customers.csv",[
    ["Name","Email","Phone","Joined"],
    ...db.customers.map(c=>[c.name,c.email,c.phone,c.joined])
  ]);
}

function exportSubscribers() {
  csvDownload("booknest-subscribers.csv",[["Email"],...db.subscribers.map(x=>[x])]);
}

function exportReport() {
  csvDownload("booknest-finance.csv",[
    ["Metric","Amount"],
    ["Revenue",revenue()],
    ["Product cost",productCost()],
    ["Expenses",expensesTotal()],
    ["Estimated profit",profit()],
    ["Illustrative GST",revenue()*db.settings.gst/(100+db.settings.gst)]
  ]);
}

function backupData() {
  const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download="booknest-backup.json";a.click();
  URL.revokeObjectURL(url);
}

function resetDatabase() {
  if(!confirm("Replace all demo data with the original catalogue?")) return;
  db=initialDatabase();
  saveDB();
  toast("Demo data restored.");
}

/* INITIALIZE */

function initialize() {
  updateCartCount();
  renderHome();

  if(db.adminSession) {
    db.adminSession=false;
    saveDB();
  }

  showPage("home");
  refreshMissingCovers();

  document.getElementById("modal").addEventListener("click",event=>{
    if(event.target.id==="modal") closeModal();
  });
}

initialize();