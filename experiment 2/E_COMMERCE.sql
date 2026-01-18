CREATE TABLE users (
    user_id INT IDENTITY(1,1) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(MAX) NOT NULL,
    phone VARCHAR(10),
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE sellers (
    seller_id INT IDENTITY(1,1) PRIMARY KEY,
    seller_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    rating DECIMAL(3,1) CHECK (rating BETWEEN 0 AND 5)
);

CREATE TABLE categories (
    category_id INT IDENTITY(1,1) PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL,
    parent_category_id INT,
    CONSTRAINT fk_parent_category FOREIGN KEY (parent_category_id)
        REFERENCES categories(category_id)
);

CREATE TABLE products (
    product_id INT IDENTITY(1,1) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(MAX),
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    category_id INT NOT NULL,
    seller_id INT NOT NULL,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT fk_category FOREIGN KEY (category_id) REFERENCES categories(category_id),
    CONSTRAINT fk_seller FOREIGN KEY (seller_id) REFERENCES sellers(seller_id)
);

CREATE TABLE product_images (
    image_id INT IDENTITY(1,1) PRIMARY KEY,
    product_id INT NOT NULL,
    image_url VARCHAR(MAX) NOT NULL,
    CONSTRAINT fk_product_image FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON DELETE CASCADE
);

CREATE TABLE inventory (
    inventory_id INT IDENTITY(1,1) PRIMARY KEY,
    product_id INT UNIQUE NOT NULL,
    available_quantity INT NOT NULL CHECK (available_quantity >= 0),
    reserved_quantity INT DEFAULT 0 CHECK (reserved_quantity >= 0),
    last_updated DATETIME DEFAULT GETDATE(),
    CONSTRAINT fk_inventory_product FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON DELETE CASCADE
);

CREATE TABLE cart (
    cart_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT fk_cart_user FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
);

CREATE TABLE cart_items (
    cart_item_id INT IDENTITY(1,1) PRIMARY KEY,
    cart_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    price_at_time DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_cart FOREIGN KEY (cart_id) REFERENCES cart(cart_id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_product FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE orders (
    order_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    order_status VARCHAR(20) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    payment_status VARCHAR(20),
    created_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE order_items (
    order_item_id INT IDENTITY(1,1) PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    price_at_purchase DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    CONSTRAINT fk_order_product FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE payments (
    payment_id INT IDENTITY(1,1) PRIMARY KEY,
    order_id INT UNIQUE NOT NULL,
    payment_method VARCHAR(30),
    payment_status VARCHAR(20),
    transaction_id VARCHAR(100),
    payment_time DATETIME DEFAULT GETDATE(),
    CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

CREATE TABLE reviews (
    review_id INT IDENTITY(1,1) PRIMARY KEY,
    product_id INT NOT NULL,
    user_id INT NOT NULL,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    comment VARCHAR(MAX),
    created_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT fk_review_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    CONSTRAINT fk_review_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT unique_review UNIQUE (product_id, user_id)
);

-- Indexes
CREATE INDEX idx_product_category ON products(category_id);
CREATE INDEX idx_product_seller ON products(seller_id);
CREATE INDEX idx_order_user ON orders(user_id);
CREATE INDEX idx_cart_user ON cart(user_id);
CREATE INDEX idx_inventory_product ON inventory(product_id);

